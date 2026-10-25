#import "SovraBleBridge.h"

static NSString * const kSovraDefaultServiceUUID = @"00005356-0000-1000-8000-00805F9B34FB";
static NSString * const kSovraWriteCharUUID     = @"00005357-0000-1000-8000-00805F9B34FB";
static NSString * const kSovraNotifyCharUUID    = @"00005358-0000-1000-8000-00805F9B34FB";

@interface SovraBlePendingWrite : NSObject
@property (nonatomic, strong) NSData *data;
@property (nonatomic, copy) void (^completion)(BOOL, NSString * _Nullable);
@end

@implementation SovraBlePendingWrite
@end

@interface SovraBleBridge ()

@property (nonatomic, strong) CBCentralManager *centralManager;
@property (nonatomic, strong) CBPeripheralManager *peripheralManager;

// Track discovered and connected peripherals
@property (nonatomic, strong) NSMutableDictionary<NSString *, CBPeripheral *> *discoveredPeripherals;
@property (nonatomic, strong) NSMutableDictionary<NSString *, CBCharacteristic *> *writeCharacteristics;
@property (nonatomic, strong) NSMutableDictionary<NSString *, CBCharacteristic *> *notifyCharacteristics;
@property (nonatomic, strong) NSMutableDictionary<NSString *, void (^)(BOOL, NSString *)> *pendingWriteCallbacks;
@property (nonatomic, strong) NSMutableDictionary<NSString *, void (^)(BOOL, NSString *, NSInteger, NSString *)> *pendingConnectCallbacks;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSMutableArray<SovraBlePendingWrite *> *> *writeQueues;
@property (nonatomic, strong) NSMutableDictionary<NSString *, SovraBlePendingWrite *> *currentInFlightWrites;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *smoothedRssiMap;

@property (nonatomic, copy, nullable) void (^pendingAdvertiseCallback)(BOOL, NSString *);
@property (nonatomic, assign) BOOL isAdvertising;
@property (nonatomic, assign) BOOL isScanning;

@end

@implementation SovraBleBridge

+ (instancetype)sharedInstance {
    static SovraBleBridge *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[SovraBleBridge alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        dispatch_queue_t bleQueue = dispatch_queue_create("network.sovra.ble", DISPATCH_QUEUE_SERIAL);
        NSDictionary *centralOptions = @{
            CBCentralManagerOptionRestoreIdentifierKey: @"SovraBleCentralRestore",
            CBCentralManagerOptionShowPowerAlertKey: @YES
        };
        _centralManager = [[CBCentralManager alloc] initWithDelegate:self queue:bleQueue options:centralOptions];

        NSDictionary *peripheralOptions = @{
            CBPeripheralManagerOptionRestoreIdentifierKey: @"SovraBlePeripheralRestore",
            CBPeripheralManagerOptionShowPowerAlertKey: @YES
        };
        _peripheralManager = [[CBPeripheralManager alloc] initWithDelegate:self queue:bleQueue options:peripheralOptions];

        _discoveredPeripherals = [NSMutableDictionary dictionary];
        _writeCharacteristics = [NSMutableDictionary dictionary];
        _notifyCharacteristics = [NSMutableDictionary dictionary];
        _pendingWriteCallbacks = [NSMutableDictionary dictionary];
        _pendingConnectCallbacks = [NSMutableDictionary dictionary];
        _writeQueues = [NSMutableDictionary dictionary];
        _currentInFlightWrites = [NSMutableDictionary dictionary];
        _smoothedRssiMap = [NSMutableDictionary dictionary];
    }
    return self;
}

#pragma mark - Status & Permissions

- (BOOL)isAvailable {
    return (self.centralManager.state == CBManagerStatePoweredOn);
}

- (NSString *)getAuthorizationStatus {
    if (@available(iOS 13.1, *)) {
        CBManagerAuthorization auth = CBManager.authorization;
        switch (auth) {
            case CBManagerAuthorizationAllowedAlways: return @"authorized";
            case CBManagerAuthorizationDenied: return @"denied";
            case CBManagerAuthorizationRestricted: return @"restricted";
            case CBManagerAuthorizationNotDetermined: return @"not_determined";
        }
    }
    return @"authorized";
}

- (NSString *)getBluetoothState {
    switch (self.centralManager.state) {
        case CBManagerStatePoweredOn: return @"powered_on";
        case CBManagerStatePoweredOff: return @"powered_off";
        case CBManagerStateUnauthorized: return @"unauthorized";
        case CBManagerStateUnsupported: return @"unsupported";
        case CBManagerStateResetting: return @"resetting";
        case CBManagerStateUnknown:
        default: return @"unknown";
    }
}

#pragma mark - CBCentralManagerDelegate & Background State Restoration

- (void)centralManager:(CBCentralManager *)central willRestoreState:(NSDictionary<NSString *, id> *)dict {
    NSArray<CBPeripheral *> *peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey];
    for (CBPeripheral *p in peripherals) {
        NSString *uuidStr = p.identifier.UUIDString;
        self.discoveredPeripherals[uuidStr] = p;
        p.delegate = self;
    }
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    if (central.state != CBManagerStatePoweredOn) {
        // CoreBluetooth disabled or reset; drop active connections and drain queues with failure
        @synchronized (self.writeQueues) {
            for (NSString *pId in self.currentInFlightWrites) {
                SovraBlePendingWrite *w = self.currentInFlightWrites[pId];
                if (w.completion) w.completion(NO, @"Bluetooth state changed to poweredOff");
            }
            [self.currentInFlightWrites removeAllObjects];

            for (NSString *pId in self.writeQueues) {
                NSMutableArray<SovraBlePendingWrite *> *queue = self.writeQueues[pId];
                for (SovraBlePendingWrite *w in queue) {
                    if (w.completion) w.completion(NO, @"Bluetooth state changed to poweredOff");
                }
            }
            [self.writeQueues removeAllObjects];
        }

        for (NSString *pId in self.pendingWriteCallbacks) {
            void (^cb)(BOOL, NSString *) = self.pendingWriteCallbacks[pId];
            if (cb) cb(NO, @"Bluetooth state changed to poweredOff");
        }
        [self.pendingWriteCallbacks removeAllObjects];
    }
}

- (void)startScanningWithServiceUuid:(NSString *)serviceUuid completion:(void (^)(BOOL, NSString * _Nullable))completion {
    if (self.centralManager.state != CBManagerStatePoweredOn) {
        completion(NO, @"CoreBluetooth CBCentralManager not powered on");
        return;
    }

    CBUUID *svcUuid = [CBUUID UUIDWithString:serviceUuid ?: kSovraDefaultServiceUUID];
    [self.centralManager scanForPeripheralsWithServices:@[svcUuid] options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @NO}];
    self.isScanning = YES;
    completion(YES, nil);
}

- (void)stopScanning {
    if (self.isScanning) {
        [self.centralManager stopScan];
        self.isScanning = NO;
    }
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
    NSString *uuidStr = peripheral.identifier.UUIDString;
    self.discoveredPeripherals[uuidStr] = peripheral;

    NSNumber *txPowerNum = advertisementData[CBAdvertisementDataTxPowerLevelKey];
    NSInteger txPower = txPowerNum ? [txPowerNum integerValue] : -59;

    // Exponential Moving Average (EMA) smoothing: smoothed = 0.25 * current + 0.75 * prev
    NSNumber *prevRssi = self.smoothedRssiMap[uuidStr];
    double smoothed = prevRssi ? ((0.25 * [RSSI doubleValue]) + (0.75 * [prevRssi doubleValue])) : [RSSI doubleValue];
    self.smoothedRssiMap[uuidStr] = @(smoothed);
    NSInteger finalRssi = (NSInteger)round(smoothed);

    NSData *svcData = nil;
    NSDictionary *serviceDataDict = advertisementData[CBAdvertisementDataServiceDataKey];
    if (serviceDataDict && serviceDataDict.count > 0) {
        svcData = serviceDataDict.allValues.firstObject;
    }
    if (!svcData) {
        svcData = [NSData data];
    }

    NSString *name = advertisementData[CBAdvertisementDataLocalNameKey] ?: peripheral.name;

    if (self.onDeviceDiscoveredWithTxPower) {
        self.onDeviceDiscoveredWithTxPower(uuidStr, finalRssi, txPower, svcData, name);
    }
    if (self.onDeviceDiscovered) {
        self.onDeviceDiscovered(uuidStr, finalRssi, svcData, name);
    }
}

#pragma mark - Connection Lifecycle

- (void)connectPeripheral:(NSString *)identifier completion:(void (^)(BOOL, NSString * _Nullable, NSInteger, NSString * _Nullable))completion {
    CBPeripheral *peripheral = self.discoveredPeripherals[identifier];
    if (!peripheral) {
        completion(NO, nil, 0, [NSString stringWithFormat:@"Peripheral %@ not found in discovered cache", identifier]);
        return;
    }

    self.pendingConnectCallbacks[identifier] = completion;
    peripheral.delegate = self;
    [self.centralManager connectPeripheral:peripheral options:nil];
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
    NSString *pId = peripheral.identifier.UUIDString;
    CBUUID *svcUuid = [CBUUID UUIDWithString:kSovraDefaultServiceUUID];
    [peripheral discoverServices:@[svcUuid]];
}

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    NSString *pId = peripheral.identifier.UUIDString;
    void (^cb)(BOOL, NSString *, NSInteger, NSString *) = self.pendingConnectCallbacks[pId];
    [self.pendingConnectCallbacks removeObjectForKey:pId];
    if (cb) {
        cb(NO, nil, 0, error.localizedDescription ?: @"Failed to connect peripheral");
    }
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    NSString *pId = peripheral.identifier.UUIDString;
    [self.writeCharacteristics removeObjectForKey:pId];
    [self.notifyCharacteristics removeObjectForKey:pId];

    // Drain and fail any pending writes in queue for this peripheral
    @synchronized (self.writeQueues) {
        SovraBlePendingWrite *inFlight = self.currentInFlightWrites[pId];
        [self.currentInFlightWrites removeObjectForKey:pId];
        if (inFlight && inFlight.completion) {
            inFlight.completion(NO, @"Peripheral disconnected during write");
        }

        NSMutableArray<SovraBlePendingWrite *> *queue = self.writeQueues[pId];
        if (queue) {
            for (SovraBlePendingWrite *pending in queue) {
                if (pending.completion) {
                    pending.completion(NO, @"Peripheral disconnected");
                }
            }
            [self.writeQueues removeObjectForKey:pId];
        }
    }

    if (self.onPeripheralDisconnected) {
        self.onPeripheralDisconnected(pId);
    }
}

- (void)disconnectPeripheral:(NSString *)identifier {
    CBPeripheral *p = self.discoveredPeripherals[identifier];
    if (p) {
        [self.centralManager cancelPeripheralConnection:p];
    }
}

#pragma mark - CBPeripheralDelegate

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
    NSString *pId = peripheral.identifier.UUIDString;
    if (error) {
        void (^cb)(BOOL, NSString *, NSInteger, NSString *) = self.pendingConnectCallbacks[pId];
        [self.pendingConnectCallbacks removeObjectForKey:pId];
        if (cb) cb(NO, nil, 0, error.localizedDescription);
        return;
    }

    for (CBService *svc in peripheral.services) {
        if ([svc.UUID.UUIDString.uppercaseString isEqualToString:kSovraDefaultServiceUUID]) {
            CBUUID *writeUuid = [CBUUID UUIDWithString:kSovraWriteCharUUID];
            CBUUID *notifyUuid = [CBUUID UUIDWithString:kSovraNotifyCharUUID];
            [peripheral discoverCharacteristics:@[writeUuid, notifyUuid] forService:svc];
            return;
        }
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    NSString *pId = peripheral.identifier.UUIDString;
    if (error) {
        void (^cb)(BOOL, NSString *, NSInteger, NSString *) = self.pendingConnectCallbacks[pId];
        [self.pendingConnectCallbacks removeObjectForKey:pId];
        if (cb) cb(NO, nil, 0, error.localizedDescription);
        return;
    }

    for (CBCharacteristic *ch in service.characteristics) {
        if ([ch.UUID.UUIDString.uppercaseString isEqualToString:kSovraWriteCharUUID]) {
            self.writeCharacteristics[pId] = ch;
        } else if ([ch.UUID.UUIDString.uppercaseString isEqualToString:kSovraNotifyCharUUID]) {
            self.notifyCharacteristics[pId] = ch;
            [peripheral setNotifyValue:YES forCharacteristic:ch];
        }
    }

    // Determine MTU
    NSInteger maxWrite = [peripheral maximumWriteValueLengthForType:CBCharacteristicWriteWithResponse];
    if (maxWrite <= 0) maxWrite = 182;

    void (^cb)(BOOL, NSString *, NSInteger, NSString *) = self.pendingConnectCallbacks[pId];
    [self.pendingConnectCallbacks removeObjectForKey:pId];
    if (cb) {
        cb(YES, pId, maxWrite, nil);
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didWriteValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    NSString *pId = peripheral.identifier.UUIDString;
    SovraBlePendingWrite *currentWrite = nil;
    @synchronized (self.writeQueues) {
        currentWrite = self.currentInFlightWrites[pId];
        [self.currentInFlightWrites removeObjectForKey:pId];
    }

    if (currentWrite && currentWrite.completion) {
        if (error) {
            currentWrite.completion(NO, error.localizedDescription);
        } else {
            currentWrite.completion(YES, nil); // Confirmed write-with-response!
        }
    }

    // Process next item in FIFO queue for this peripheral
    [self processNextWriteInQueueForPeripheralId:pId];
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) return;
    NSString *pId = peripheral.identifier.UUIDString;
    NSData *data = characteristic.value;
    if (data && self.onDataReceived) {
        self.onDataReceived(pId, data);
    }
}

#pragma mark - Central Scanning Duty-Cycle

- (void)setScanDutyCycle:(NSString *)mode completion:(void (^)(BOOL, NSString * _Nullable))completion {
    // Modes: "ACTIVE" (low-latency continuous scan) or "BACKGROUND_LOW_POWER"
    if (completion) {
        completion(YES, nil);
    }
}

#pragma mark - Data Transmission FIFO Queue

- (void)processNextWriteInQueueForPeripheralId:(NSString *)peripheralId {
    SovraBlePendingWrite *writeToExecute = nil;
    @synchronized (self.writeQueues) {
        if (self.currentInFlightWrites[peripheralId] != nil) {
            // Write currently in flight; wait for peripheral:didWriteValueForCharacteristic:error:
            return;
        }
        NSMutableArray<SovraBlePendingWrite *> *queue = self.writeQueues[peripheralId];
        if (!queue || queue.count == 0) {
            return;
        }
        writeToExecute = queue.firstObject;
        [queue removeObjectAtIndex:0];
        self.currentInFlightWrites[peripheralId] = writeToExecute;
    }

    CBPeripheral *peripheral = self.discoveredPeripherals[peripheralId];
    CBCharacteristic *writeChar = self.writeCharacteristics[peripheralId];

    if (!peripheral || !writeChar) {
        @synchronized (self.writeQueues) {
            [self.currentInFlightWrites removeObjectForKey:peripheralId];
        }
        if (writeToExecute.completion) {
            writeToExecute.completion(NO, @"Peripheral or write characteristic disconnected");
        }
        [self processNextWriteInQueueForPeripheralId:peripheralId];
        return;
    }

    [peripheral writeValue:writeToExecute.data forCharacteristic:writeChar type:CBCharacteristicWriteWithResponse];
}

- (void)writeCharacteristic:(NSString *)peripheralId data:(NSData *)data writeType:(NSString *)writeType completion:(void (^)(BOOL, NSString * _Nullable))completion {
    CBPeripheral *peripheral = self.discoveredPeripherals[peripheralId];
    CBCharacteristic *writeChar = self.writeCharacteristics[peripheralId];

    if (!peripheral || !writeChar) {
        if (completion) completion(NO, @"Peripheral or write characteristic not connected");
        return;
    }

    NSInteger maxWrite = [peripheral maximumWriteValueLengthForType:CBCharacteristicWriteWithResponse];
    if (maxWrite <= 0) maxWrite = 182;
    NSInteger maxPayload = MAX(20, maxWrite - 3);

    if (data.length <= maxPayload) {
        SovraBlePendingWrite *pending = [[SovraBlePendingWrite alloc] init];
        pending.data = data;
        pending.completion = completion;

        @synchronized (self.writeQueues) {
            NSMutableArray<SovraBlePendingWrite *> *queue = self.writeQueues[peripheralId];
            if (!queue) {
                queue = [NSMutableArray array];
                self.writeQueues[peripheralId] = queue;
            }
            [queue addObject:pending];
        }
    } else {
        // Native MTU boundary chunking guard matching Android Kotlin parity:
        // Slice into sequential frames with 2-byte header [seq, total]
        NSInteger chunkPayloadSize = MAX(18, maxPayload - 2);
        NSInteger totalChunks = (NSInteger)ceil((double)data.length / (double)chunkPayloadSize);
        NSInteger offset = 0;

        for (NSInteger seq = 0; seq < totalChunks; seq++) {
            NSInteger len = MIN(chunkPayloadSize, (NSInteger)data.length - offset);
            NSMutableData *slice = [NSMutableData dataWithCapacity:len + 2];
            uint8_t header[2] = { (uint8_t)seq, (uint8_t)totalChunks };
            [slice appendBytes:header length:2];
            [slice appendBytes:(const uint8_t *)data.bytes + offset length:len];
            offset += len;

            BOOL isLast = (seq == totalChunks - 1);
            SovraBlePendingWrite *pending = [[SovraBlePendingWrite alloc] init];
            pending.data = slice;
            pending.completion = ^(BOOL success, NSString * _Nullable error) {
                if (!success) {
                    if (completion) completion(NO, error ?: @"Chunk write failed");
                } else if (isLast) {
                    if (completion) completion(YES, nil);
                }
            };

            @synchronized (self.writeQueues) {
                NSMutableArray<SovraBlePendingWrite *> *queue = self.writeQueues[peripheralId];
                if (!queue) {
                    queue = [NSMutableArray array];
                    self.writeQueues[peripheralId] = queue;
                }
                [queue addObject:pending];
            }
        }
    }

    [self processNextWriteInQueueForPeripheralId:peripheralId];
}

- (void)setNotifyValue:(NSString *)peripheralId enabled:(BOOL)enabled completion:(void (^)(BOOL, NSString * _Nullable))completion {
    CBPeripheral *peripheral = self.discoveredPeripherals[peripheralId];
    CBCharacteristic *notifyChar = self.notifyCharacteristics[peripheralId];

    if (!peripheral || !notifyChar) {
        completion(NO, @"Peripheral or notify characteristic not connected");
        return;
    }

    [peripheral setNotifyValue:enabled forCharacteristic:notifyChar];
    completion(YES, nil);
}

#pragma mark - CBPeripheralManagerDelegate (Peripheral Role & Restoration)

- (void)peripheralManager:(CBPeripheralManager *)peripheral willRestoreState:(NSDictionary<NSString *, id> *)dict {
    NSArray<CBMutableService *> *services = dict[CBPeripheralManagerRestoredStateServicesKey];
    if (services.count > 0) {
        self.isAdvertising = YES;
    }
}

- (void)peripheralManagerDidUpdateState:(CBPeripheralManager *)peripheral {
    // Monitored
}

- (void)startAdvertisingWithServiceUuid:(NSString *)serviceUuid serviceData:(NSData *)serviceData completion:(void (^)(BOOL, NSString * _Nullable))completion {
    if (self.peripheralManager.state != CBManagerStatePoweredOn) {
        completion(NO, @"CBPeripheralManager is not powered on");
        return;
    }

    CBUUID *svcUuid = [CBUUID UUIDWithString:serviceUuid ?: kSovraDefaultServiceUUID];

    // Setup GATT Service & Characteristics
    CBMutableService *svc = [[CBMutableService alloc] initWithType:svcUuid primary:YES];

    CBMutableCharacteristic *writeChar = [[CBMutableCharacteristic alloc]
        initWithType:[CBUUID UUIDWithString:kSovraWriteCharUUID]
        properties:CBCharacteristicPropertyWrite | CBCharacteristicPropertyWriteWithoutResponse
        value:nil
        permissions:CBAttributePermissionsWriteable];

    CBMutableCharacteristic *notifyChar = [[CBMutableCharacteristic alloc]
        initWithType:[CBUUID UUIDWithString:kSovraNotifyCharUUID]
        properties:CBCharacteristicPropertyNotify
        value:nil
        permissions:CBAttributePermissionsReadable];

    svc.characteristics = @[writeChar, notifyChar];
    [self.peripheralManager removeAllServices];
    [self.peripheralManager addService:svc];

    self.pendingAdvertiseCallback = completion;
    NSDictionary *advData = @{
        CBAdvertisementDataServiceUUIDsKey: @[svcUuid],
        CBAdvertisementDataLocalNameKey: @"Sovra-Mesh"
    };

    [self.peripheralManager startAdvertising:advData];
}

- (void)peripheralManagerDidStartAdvertising:(CBPeripheralManager *)peripheral error:(NSError *)error {
    self.isAdvertising = (error == nil);
    void (^cb)(BOOL, NSString *) = self.pendingAdvertiseCallback;
    self.pendingAdvertiseCallback = nil;
    if (cb) {
        if (error) {
            cb(NO, error.localizedDescription);
        } else {
            cb(YES, nil);
        }
    }
}

- (void)stopAdvertising {
    if (self.isAdvertising) {
        [self.peripheralManager stopAdvertising];
        self.isAdvertising = NO;
    }
}

@end
