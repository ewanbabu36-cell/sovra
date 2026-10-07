#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>

NS_ASSUME_NONNULL_BEGIN

@interface SovraBleBridge : NSObject <CBCentralManagerDelegate, CBPeripheralDelegate, CBPeripheralManagerDelegate>

+ (instancetype)sharedInstance;

// Status & Permissions
- (BOOL)isAvailable;
- (NSString *)getAuthorizationStatus;
- (NSString *)getBluetoothState;

// Central Operations
- (void)startScanningWithServiceUuid:(NSString *)serviceUuid completion:(void (^)(BOOL success, NSString * _Nullable error))completion;
- (void)stopScanning;
- (void)connectPeripheral:(NSString *)identifier completion:(void (^)(BOOL success, NSString * _Nullable peripheralId, NSInteger maxWriteLength, NSString * _Nullable error))completion;
- (void)disconnectPeripheral:(NSString *)identifier;

// Peripheral Operations
- (void)startAdvertisingWithServiceUuid:(NSString *)serviceUuid serviceData:(NSData *)serviceData completion:(void (^)(BOOL success, NSString * _Nullable error))completion;
- (void)stopAdvertising;

// Data Transfer
- (void)writeCharacteristic:(NSString *)peripheralId data:(NSData *)data writeType:(NSString *)writeType completion:(void (^)(BOOL success, NSString * _Nullable error))completion;
- (void)setNotifyValue:(NSString *)peripheralId enabled:(BOOL)enabled completion:(void (^)(BOOL success, NSString * _Nullable error))completion;

// Callbacks for JS Runtime Bridge
@property (nonatomic, copy, nullable) void (^onDeviceDiscovered)(NSString *identifier, NSInteger rssi, NSData *serviceData, NSString * _Nullable name);
@property (nonatomic, copy, nullable) void (^onDataReceived)(NSString *peripheralId, NSData *data);
@property (nonatomic, copy, nullable) void (^onPeripheralDisconnected)(NSString *peripheralId);

@end

NS_ASSUME_NONNULL_END
