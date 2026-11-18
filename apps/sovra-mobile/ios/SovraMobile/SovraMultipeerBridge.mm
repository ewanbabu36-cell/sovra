#import "SovraMultipeerBridge.h"
#import <CommonCrypto/CommonDigest.h>

static NSString *const kDefaultServiceType = @"sovra-media";

@interface SovraMultipeerBridge ()

@property (nonatomic, strong) MCPeerID *localPeerID;
@property (nonatomic, strong, nullable) MCSession *mcSession;
@property (nonatomic, strong, nullable) MCNearbyServiceAdvertiser *advertiser;
@property (nonatomic, strong, nullable) MCNearbyServiceBrowser *browser;
@property (nonatomic, strong) NSMutableDictionary<NSString *, MCPeerID *> *discoveredPeers;
@property (nonatomic, assign) BOOL hasListeners;

@end

@implementation SovraMultipeerBridge

RCT_EXPORT_MODULE(SovraMultipeerBridge);

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

+ (instancetype)sharedInstance {
    static SovraMultipeerBridge *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[SovraMultipeerBridge alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        NSString *deviceName = [[UIDevice currentDevice] name];
        _localPeerID = [[MCPeerID alloc] initWithDisplayName:deviceName];
        _discoveredPeers = [[NSMutableDictionary alloc] init];
        _hasListeners = NO;
        [self setupSession];
    }
    return self;
}

- (void)setupSession {
    if (_mcSession) {
        [_mcSession disconnect];
        _mcSession.delegate = nil;
    }
    _mcSession = [[MCSession alloc] initWithPeer:_localPeerID securityIdentity:nil encryptionPreference:MCEncryptionRequired];
    _mcSession.delegate = self;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[
        @"onPeerFound",
        @"onPeerLost",
        @"onConnectionStateChanged",
        @"onStreamReceived",
        @"onTransferProgress"
    ];
}

- (void)startObserving {
    _hasListeners = YES;
}

- (void)stopObserving {
    _hasListeners = NO;
}

// ==========================================
// REACT NATIVE EXPORTED METHODS
// ==========================================

RCT_EXPORT_METHOD(startAdvertising:(NSString *)serviceType
                  discoveryInfo:(NSDictionary *)info
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *st = (serviceType && serviceType.length > 0) ? serviceType : kDefaultServiceType;
    [self startAdvertisingService:st discoveryInfo:info completion:^(BOOL success, NSString * _Nullable error) {
        if (success) {
            resolve(@{@"success": @YES, @"serviceType": st});
        } else {
            reject(@"ADVERTISE_ERROR", error ?: @"Failed to start advertising", nil);
        }
    }];
}

RCT_EXPORT_METHOD(stopAdvertising:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self stopAdvertisingService];
    resolve(@{@"success": @YES});
}

RCT_EXPORT_METHOD(startBrowsing:(NSString *)serviceType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSString *st = (serviceType && serviceType.length > 0) ? serviceType : kDefaultServiceType;
    [self startBrowsingService:st completion:^(BOOL success, NSString * _Nullable error) {
        if (success) {
            resolve(@{@"success": @YES, @"serviceType": st});
        } else {
            reject(@"BROWSE_ERROR", error ?: @"Failed to start browsing", nil);
        }
    }];
}

RCT_EXPORT_METHOD(stopBrowsing:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self stopBrowsingService];
    resolve(@{@"success": @YES});
}

RCT_EXPORT_METHOD(invitePeer:(NSString *)peerDisplayName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    MCPeerID *target = self.discoveredPeers[peerDisplayName];
    if (!target) {
        reject(@"PEER_NOT_FOUND", [NSString stringWithFormat:@"Peer '%@' not in discovered table", peerDisplayName], nil);
        return;
    }
    if (!self.browser) {
        reject(@"BROWSER_NOT_RUNNING", @"Multipeer browser is not active", nil);
        return;
    }
    [self.browser invitePeer:target toSession:self.mcSession withContext:nil timeout:30];
    resolve(@{@"success": @YES, @"peer": peerDisplayName});
}

RCT_EXPORT_METHOD(sendStream:(NSString *)transferId
                  base64Payload:(NSString *)base64Payload
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendStreamData:transferId base64Payload:base64Payload completion:^(BOOL success, NSString * _Nullable sha256Hex, NSString * _Nullable error) {
        if (success) {
            resolve(@{@"success": @YES, @"transferId": transferId, @"sha256Hex": sha256Hex ?: @""});
        } else {
            reject(@"SEND_STREAM_ERROR", error ?: @"Failed to send media stream", nil);
        }
    }];
}

RCT_EXPORT_METHOD(disconnect:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self disconnectSession];
    resolve(@{@"success": @YES});
}

// ==========================================
// CORE MULTIPEER IMPLEMENTATION
// ==========================================

- (void)startAdvertisingService:(NSString *)serviceType discoveryInfo:(nullable NSDictionary<NSString *, NSString *> *)info completion:(void (^)(BOOL, NSString * _Nullable))completion {
    [self stopAdvertisingService];
    _advertiser = [[MCNearbyServiceAdvertiser alloc] initWithPeer:_localPeerID discoveryInfo:info serviceType:serviceType];
    _advertiser.delegate = self;
    [_advertiser startAdvertisingPeer];
    if (completion) completion(YES, nil);
}

- (void)stopAdvertisingService {
    if (_advertiser) {
        [_advertiser stopAdvertisingPeer];
        _advertiser.delegate = nil;
        _advertiser = nil;
    }
}

- (void)startBrowsingService:(NSString *)serviceType completion:(void (^)(BOOL, NSString * _Nullable))completion {
    [self stopBrowsingService];
    _browser = [[MCNearbyServiceBrowser alloc] initWithPeer:_localPeerID serviceType:serviceType];
    _browser.delegate = self;
    [_browser startBrowsingForPeers];
    if (completion) completion(YES, nil);
}

- (void)stopBrowsingService {
    if (_browser) {
        [_browser stopBrowsingForPeers];
        _browser.delegate = nil;
        _browser = nil;
    }
    [self.discoveredPeers removeAllObjects];
}

- (void)sendStreamData:(NSString *)transferId base64Payload:(NSString *)base64Payload completion:(void (^)(BOOL, NSString * _Nullable, NSString * _Nullable))completion {
    if (!_mcSession || _mcSession.connectedPeers.count == 0) {
        if (completion) completion(NO, nil, @"No connected peers in Multipeer session");
        return;
    }

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_HIGH, 0), ^{
        NSData *payloadData = [[NSData alloc] initWithBase64EncodedString:base64Payload options:0];
        if (!payloadData || payloadData.length == 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (completion) completion(NO, nil, @"Invalid or empty base64 payload");
            });
            return;
        }

        // Calculate SHA-256
        uint8_t digest[CC_SHA256_DIGEST_LENGTH];
        CC_SHA256(payloadData.bytes, (CC_LONG)payloadData.length, digest);
        NSMutableString *shaHex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
        for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
            [shaHex appendFormat:@"%02x", digest[i]];
        }

        // Binary Wire Framing:
        // [TransferId: 36 bytes UTF8] [PayloadSize: 8 bytes Big-Endian] [PayloadBytes]
        NSMutableData *packet = [NSMutableData data];
        NSString *paddedId = [transferId stringByPaddingToLength:36 withString:@" " startingAtIndex:0];
        NSData *idData = [paddedId dataUsingEncoding:NSUTF8StringEncoding];
        [packet appendData:idData];

        uint64_t totalLen = CFSwapInt64HostToBig((uint64_t)payloadData.length);
        [packet appendBytes:&totalLen length:sizeof(totalLen)];
        [packet appendData:payloadData];

        NSError *sendError = nil;
        BOOL sent = [self.mcSession sendData:packet toPeers:self.mcSession.connectedPeers withMode:MCSessionSendDataReliable error:&sendError];

        dispatch_async(dispatch_get_main_queue(), ^{
            if (sent) {
                if (completion) completion(YES, shaHex, nil);
            } else {
                if (completion) completion(NO, nil, sendError.localizedDescription ?: @"Multipeer send failed");
            }
        });
    });
}

- (void)disconnectSession {
    [self stopAdvertisingService];
    [self stopBrowsingService];
    if (_mcSession) {
        [_mcSession disconnect];
    }
}

// ==========================================
// MCNearbyServiceAdvertiserDelegate
// ==========================================

- (void)advertiser:(MCNearbyServiceAdvertiser *)advertiser didReceiveInvitationFromPeer:(MCPeerID *)peerID withContext:(nullable NSData *)context invitationHandler:(void (^)(BOOL, MCSession * _Nullable))invitationHandler {
    // Automatically accept pairing invitation from recognized Sovra peer
    if (invitationHandler) {
        invitationHandler(YES, self.mcSession);
    }
}

// ==========================================
// MCNearbyServiceBrowserDelegate
// ==========================================

- (void)browser:(MCNearbyServiceBrowser *)browser foundPeer:(MCPeerID *)peerID withDiscoveryInfo:(nullable NSDictionary<NSString *, NSString *> *)info {
    self.discoveredPeers[peerID.displayName] = peerID;
    if (self.hasListeners) {
        [self sendEventWithName:@"onPeerFound" body:@{
            @"peerId": peerID.displayName,
            @"discoveryInfo": info ?: @{}
        }];
    }
}

- (void)browser:(MCNearbyServiceBrowser *)browser lostPeer:(MCPeerID *)peerID {
    [self.discoveredPeers removeObjectForKey:peerID.displayName];
    if (self.hasListeners) {
        [self sendEventWithName:@"onPeerLost" body:@{
            @"peerId": peerID.displayName
        }];
    }
}

// ==========================================
// MCSessionDelegate
// ==========================================

- (void)session:(MCSession *)session peer:(MCPeerID *)peerID didChangeState:(MCSessionState)state {
    NSString *stateStr = @"NOT_CONNECTED";
    if (state == MCSessionStateConnecting) state = @"CONNECTING";
    if (state == MCSessionStateConnected) state = @"CONNECTED";

    if (self.hasListeners) {
        [self sendEventWithName:@"onConnectionStateChanged" body:@{
            @"peerId": peerID.displayName,
            @"state": stateStr
        }];
    }
}

- (void)session:(MCSession *)session didReceiveData:(NSData *)data fromPeer:(MCPeerID *)peerID {
    if (data.length < 44) return; // Header must be at least 44 bytes

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_HIGH, 0), ^{
        NSData *idData = [data subdataWithRange:NSMakeRange(0, 36)];
        NSString *transferId = [[[NSString alloc] initWithData:idData encoding:NSUTF8StringEncoding] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];

        uint64_t bigEndianLen = 0;
        [data getBytes:&bigEndianLen range:NSMakeRange(36, 8)];
        uint64_t totalLength = CFSwapInt64BigToHost(bigEndianLen);

        if (data.length < 44 + totalLength) return;

        NSData *payloadData = [data subdataWithRange:NSMakeRange(44, (NSUInteger)totalLength)];

        // Compute SHA-256
        uint8_t digest[CC_SHA256_DIGEST_LENGTH];
        CC_SHA256(payloadData.bytes, (CC_LONG)payloadData.length, digest);
        NSMutableString *shaHex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
        for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
            [shaHex appendFormat:@"%02x", digest[i]];
        }

        NSString *base64 = [payloadData base64EncodedStringWithOptions:0];

        dispatch_async(dispatch_get_main_queue(), ^{
            if (self.hasListeners) {
                [self sendEventWithName:@"onStreamReceived" body:@{
                    @"transferId": transferId,
                    @"sender": peerID.displayName,
                    @"dataBase64": base64,
                    @"sha256Hex": shaHex
                }];
            }
        });
    });
}

- (void)session:(MCSession *)session didReceiveStream:(NSInputStream *)stream withName:(NSString *)streamName fromPeer:(MCPeerID *)peerID {}

- (void)session:(MCSession *)session didStartReceivingResourceWithName:(NSString *)resourceName fromPeer:(MCPeerID *)peerID withProgress:(NSProgress *)progress {}

- (void)session:(MCSession *)session didFinishReceivingResourceWithName:(NSString *)resourceName fromPeer:(MCPeerID *)peerID atURL:(nullable NSURL *)localURL withError:(nullable NSError *)error {}

@end
