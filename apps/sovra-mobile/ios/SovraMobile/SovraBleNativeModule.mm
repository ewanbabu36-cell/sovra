#import "SovraBleNativeModule.h"

@implementation SovraBleNativeModule {
    bool hasListeners;
}

RCT_EXPORT_MODULE(SovraBleNative);

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        SovraBleBridge *bridge = [SovraBleBridge sharedInstance];
        __weak typeof(self) weakSelf = self;

        bridge.onDeviceDiscovered = ^(NSString *identifier, NSInteger rssi, NSData *serviceData, NSString * _Nullable name) {
            __strong typeof(weakSelf) strongSelf = weakSelf;
            if (strongSelf && strongSelf->hasListeners) {
                NSString *serviceDataB64 = [serviceData base64EncodedStringWithOptions:0];
                [strongSelf sendEventWithName:@"onDeviceDiscovered" body:@{
                    @"address": identifier,
                    @"rssi": @(rssi),
                    @"serviceData": serviceDataB64 ?: @"",
                    @"name": name ?: @""
                }];
            }
        };

        bridge.onDataReceived = ^(NSString *peripheralId, NSData *data) {
            __strong typeof(weakSelf) strongSelf = weakSelf;
            if (strongSelf && strongSelf->hasListeners) {
                NSString *dataB64 = [data base64EncodedStringWithOptions:0];
                [strongSelf sendEventWithName:@"onIncomingDataReceived" body:@{
                    @"gattId": peripheralId,
                    @"data": dataB64 ?: @""
                }];
            }
        };

        bridge.onPeripheralDisconnected = ^(NSString *peripheralId) {
            __strong typeof(weakSelf) strongSelf = weakSelf;
            if (strongSelf && strongSelf->hasListeners) {
                [strongSelf sendEventWithName:@"onPeerDisconnected" body:@{
                    @"gattId": peripheralId
                }];
            }
        };
    }
    return self;
}

- (void)startObserving {
    hasListeners = YES;
}

- (void)stopObserving {
    hasListeners = NO;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"onDeviceDiscovered", @"onIncomingDataReceived", @"onPeerDisconnected"];
}

RCT_EXPORT_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(@([[SovraBleBridge sharedInstance] isAvailable]));
}

RCT_EXPORT_METHOD(isBluetoothEnabled:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(@([[SovraBleBridge sharedInstance] isAvailable]));
}

RCT_EXPORT_METHOD(hasPermissions:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *status = [[SovraBleBridge sharedInstance] getAuthorizationStatus];
    resolve(@([status isEqualToString:@"authorized"]));
}

RCT_EXPORT_METHOD(startAdvertising:(NSString *)serviceUuid data:(NSString *)base64Data resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *data = [[NSData alloc] initWithBase64EncodedString:base64Data options:0];
    [[SovraBleBridge sharedInstance] startAdvertisingWithServiceUuid:serviceUuid serviceData:data completion:^(BOOL success, NSString * _Nullable error) {
        if (success) {
            resolve(@YES);
        } else {
            reject(@"ADVERTISE_FAILED", error ?: @"Failed to advertise BLE service", nil);
        }
    }];
}

RCT_EXPORT_METHOD(stopAdvertising:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [[SovraBleBridge sharedInstance] stopAdvertising];
    resolve(@YES);
}

RCT_EXPORT_METHOD(startScanning:(NSString *)serviceUuid resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [[SovraBleBridge sharedInstance] startScanningWithServiceUuid:serviceUuid completion:^(BOOL success, NSString * _Nullable error) {
        if (success) {
            resolve(@YES);
        } else {
            reject(@"SCAN_FAILED", error ?: @"Failed to start BLE scanning", nil);
        }
    }];
}

RCT_EXPORT_METHOD(stopScanning:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [[SovraBleBridge sharedInstance] stopScanning];
    resolve(@YES);
}

RCT_EXPORT_METHOD(connectGatt:(NSString *)address resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [[SovraBleBridge sharedInstance] connectPeripheral:address completion:^(BOOL success, NSString * _Nullable peripheralId, NSInteger maxWriteLength, NSString * _Nullable error) {
        if (success && peripheralId) {
            resolve(@{
                @"gattId": peripheralId,
                @"mtu": @(maxWriteLength)
            });
        } else {
            reject(@"CONNECT_FAILED", error ?: @"Failed to connect to peripheral", nil);
        }
    }];
}

RCT_EXPORT_METHOD(disconnectGatt:(NSString *)gattId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [[SovraBleBridge sharedInstance] disconnectPeripheral:gattId];
    resolve(@YES);
}

RCT_EXPORT_METHOD(writeCharacteristic:(NSString *)gattId data:(NSString *)base64Data resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSData *data = [[NSData alloc] initWithBase64EncodedString:base64Data options:0];
    [[SovraBleBridge sharedInstance] writeCharacteristic:gattId data:data writeType:@"withResponse" completion:^(BOOL success, NSString * _Nullable error) {
        if (success) {
            resolve(@YES);
        } else {
            reject(@"WRITE_FAILED", error ?: @"GATT write failed", nil);
        }
    }];
}

@end
