#import <Foundation/Foundation.h>
#import <MultipeerConnectivity/MultipeerConnectivity.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * SovraMultipeerBridge: High-Throughput Offline Media Transport for iOS
 * Wraps Apple's MultipeerConnectivity Framework (Wi-Fi Direct / AWDL / Peer-to-Peer Wi-Fi)
 */
@interface SovraMultipeerBridge : RCTEventEmitter <RCTBridgeModule, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate, MCSessionDelegate>

+ (instancetype)sharedInstance;

- (void)startAdvertisingService:(NSString *)serviceType discoveryInfo:(nullable NSDictionary<NSString *, NSString *> *)info completion:(void (^)(BOOL success, NSString * _Nullable error))completion;
- (void)stopAdvertisingService;
- (void)startBrowsingService:(NSString *)serviceType completion:(void (^)(BOOL success, NSString * _Nullable error))completion;
- (void)stopBrowsingService;
- (void)sendStreamData:(NSString *)transferId base64Payload:(NSString *)base64Payload completion:(void (^)(BOOL success, NSString * _Nullable sha256Hex, NSString * _Nullable error))completion;
- (void)disconnectSession;

@end

NS_ASSUME_NONNULL_END
