#import "SovraBleBridge.h"

static NSString * const kSovraDefaultServiceUUID = @"00005356-0000-1000-8000-00805F9B34FB";
static NSString * const kSovraWriteCharUUID     = @"00005357-0000-1000-8000-00805F9B34FB";
static NSString * const kSovraNotifyCharUUID    = @"00005358-0000-1000-8000-00805F9B34FB";

@interface SovraBleBridge ()

@property (nonatomic, strong) CBCentralManager *centralManager;
@property (nonatomic, strong) CBPeripheralManager *peripheralManager;

// Track discovered and connected peripherals
@property (nonatomic, strong) NSMutableDictionary<NSString *, CBPeripheral *> *discoveredPeripherals;
@property (nonatomic, strong) NSMutableDictionary<NSString *, CBCharacteristic *> *writeCharacteristics;
@property (nonatomic, strong) NSMutableDictionary<NSString *, CBCharacteristic *> *notifyCharacteristics;
@property (nonatomic, strong) NSMutableDictionary<NSString *, void (^)(BOOL, NSString *)> *pendingWriteCallbacks;
@property (nonatomic, strong) NSMutableDictionary<NSString *, void (^)(BOOL, NSString *, NSInteger, NSString *)> *pendingConnectCallbacks;

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
        _centralManager = [[CBCentralManager alloc] initWithDelegate:self queue:bleQueue];
        _peripheralManager = [[CBPeripheralManager alloc] initWithDelegate:self queue:bleQueue];
        _discoveredPeripherals = [NSMutableDictionary dictionary];
        _writeCharacteristics = [NSMutableDictionary dictionary];
        _notifyCharacteristics = [NSMutableDictionary dictionary];
        _pendingWriteCallbacks = [NSMutableDictionary dictionary];
        _pendingConnectCallbacks = [NSMutableDictionary dictionary];
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
            case CBManagerAuthorizationAllowedAlways: return @"allowed";
            case CBManagerAuthorizationDenied: return @"denied";
            case CBManagerAuthorizationRestricted: return @"restricted";
            case CBManagerAuthorizationNotDetermined: return @"not_determined";
        }
    }
    return @"allowed";
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

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    if (central.state != CBManagerStatePoweredOn) {
        // CoreBluetooth disabled or reset; drop active connections
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

    NSData *svcData = nil;
    NSDictionary *serviceDataDict = advertisementData[CBAdvertisementDataServiceDataKey];
    if (serviceDataDict && serviceDataDict.count > 0) {
        svcData = serviceDataDict.allValues.firstObject;
    }
    if (!svcData) {
        svcData = [NSData data];
    }

    NSString *name = advertisementData[CBAdvertisementDataLocalNameKey] ?: peripheral.name;

    if (self.onDeviceDiscovered) {
        self.onDeviceDiscovered(uuidStr, [RSSI integerValue], svcData, name);
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
    void (^cb)(BOOL, NSString *) = self.pendingWriteCallbacks[pId];
    [self.pendingWriteCallbacks removeObjectForKey:pId];

    if (cb) {
        if (error) {
            cb(NO, error.localizedDescription);
        } else {
            cb(YES, nil); // Confirmed write-with-response!
        }
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) return;
    NSString *pId = peripheral.identifier.UUIDString;
    NSData *data = characteristic.value;
    if (data && self.onDataReceived) {
        self.onDataReceived(pId, data);
    }
}

#pragma mark - Data Transmission

- (void)writeCharacteristic:(NSString *)peripheralId data:(NSData *)data writeType:(NSString *)writeType completion:(void (^)(BOOL, NSString * _Nullable))completion {
    CBPeripheral *peripheral = self.discoveredPeripherals[peripheralId];
    CBCharacteristic *writeChar = self.writeCharacteristics[peripheralId];

    if (!peripheral || !writeChar) {
        completion(NO, @"Peripheral or write characteristic not connected");
        return;
    }

    if (self.pendingWriteCallbacks[peripheralId] != nil) {
        completion(NO, @"Previous CoreBluetooth write still pending");
        return;
    }

    self.pendingWriteCallbacks[peripheralId] = completion;
    [peripheral writeValue:data forCharacteristic:writeChar type:CBCharacteristicWriteWithResponse];
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

#pragma mark - CBPeripheralManagerDelegate (Peripheral Role)

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
