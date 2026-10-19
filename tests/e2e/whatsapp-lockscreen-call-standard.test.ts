/**
 * @file tests/e2e/whatsapp-lockscreen-call-standard.test.ts
 * SOVRA WHATSAPP-GRADE LOCKSCREEN INCOMING CALL VERIFICATION SUITE
 *
 * Verifies:
 * 1. Android Manifest declares full-screen intents, wake locks, and lockscreen activity flags:
 *    - USE_FULL_SCREEN_INTENT, POST_NOTIFICATIONS, VIBRATE, SYSTEM_ALERT_WINDOW
 *    - android:showWhenLocked="true", android:turnScreenOn="true", android:showForAllUsers="true"
 * 2. Native Android Kotlin implementation (MainActivity.kt):
 *    - setShowWhenLocked(true), setTurnScreenOn(true), FLAG_KEEP_SCREEN_ON, FLAG_SHOW_WHEN_LOCKED
 *    - High-priority NotificationChannel ("sovra_incoming_calls", IMPORTANCE_HIGH, VISIBILITY_PUBLIC)
 *    - Full-screen intent with NotificationCompat.Builder, setFullScreenIntent, and action buttons:
 *      🟢 Accept (autoAnswerCall Intent) and 🔴 Decline (declineCall Intent)
 *    - Screen WakeLock power management (ACQUIRE_CAUSES_WAKEUP)
 *    - SovraCallJsBridge exposed to JavaScript as "SovraCallNative"
 *    - onNewIntent & launch intent dispatch to web runtime (autoAnswerIncomingCallById, declineIncomingCall)
 * 3. PWA Service Worker Lockscreen handling (scripts/dev-server.ts):
 *    - SHOW_INCOMING_CALL_NOTIFICATION with actions: accept (🟢 Accept) and decline (🔴 Decline)
 *    - notificationclick opens/focuses client window with ?autoAnswerCall=${callId}
 *    - decline action directly posts to /api/call/end
 * 4. Dev Server Client Call Engine (scripts/dev-server.ts):
 *    - SSE call_signal event dispatches on call_invite
 *    - pollIncomingCalls does NOT block on document.hidden, keeping incoming call detection active during screen lock
 *    - dispatchSystemIncomingCallNotification triggers native bridge, Service Worker, and navigator.wakeLock / vibrate
 *    - autoAnswerIncomingCallById automatically answers calls when invoked from lockscreen intent / SW click
 * 5. Mobile App Root Layer (apps/sovra-mobile):
 *    - api.ts exports fetchIncomingCall, declineCall, endCall, answerCall, MobileIncomingCall
 *    - BottomTabNavigator.tsx contains background polling across all tabs without document.hidden abort
 *    - BottomTabNavigator.tsx renders WhatsApp-style heads-up overlay (#mobileIncomingCallOverlay, #btnAcceptIncomingCall, #btnDeclineIncomingCall)
 *    - BottomTabNavigator.tsx renders CallScreen directly at the super-app root level across Feed, Reels, Watch, Chats, Me
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('WhatsApp-Standard Lockscreen Call Architecture & Integrity', () => {
  const rootDir = process.cwd();
  const manifestPath = path.resolve(rootDir, 'apps/sovra-mobile/android/app/src/main/AndroidManifest.xml');
  const mainActivityPath = path.resolve(rootDir, 'apps/sovra-mobile/android/app/src/main/java/network/sovra/mobile/MainActivity.kt');
  const devServerPath = path.resolve(rootDir, 'scripts/dev-server.ts');
  const mobileApiPath = path.resolve(rootDir, 'apps/sovra-mobile/src/services/api.ts');
  const bottomNavPath = path.resolve(rootDir, 'apps/sovra-mobile/src/navigation/BottomTabNavigator.tsx');

  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const mainActivityContent = fs.readFileSync(mainActivityPath, 'utf8');
  const devServerContent = fs.readFileSync(devServerPath, 'utf8');
  const mobileApiContent = fs.readFileSync(mobileApiPath, 'utf8');
  const bottomNavContent = fs.readFileSync(bottomNavPath, 'utf8');

  describe('1. Android Native Manifest & Permissions Configuration', () => {
    it('declares USE_FULL_SCREEN_INTENT and lockscreen wake permissions', () => {
      expect(manifestContent).toContain('android.permission.USE_FULL_SCREEN_INTENT');
      expect(manifestContent).toContain('android.permission.WAKE_LOCK');
      expect(manifestContent).toContain('android.permission.VIBRATE');
      expect(manifestContent).toContain('android.permission.POST_NOTIFICATIONS');
      expect(manifestContent).toContain('android.permission.SYSTEM_ALERT_WINDOW');
      expect(manifestContent).toContain('android.permission.FOREGROUND_SERVICE_PHONE_CALL');
      expect(manifestContent).toContain('android.permission.MANAGE_OWN_CALLS');
    });

    it('configures MainActivity with showWhenLocked and turnScreenOn attributes', () => {
      expect(manifestContent).toContain('android:showWhenLocked="true"');
      expect(manifestContent).toContain('android:turnScreenOn="true"');
      expect(manifestContent).toContain('android:showForAllUsers="true"');
      expect(manifestContent).toContain('android:inheritShowWhenLocked="true"');
    });
  });

  describe('2. Native Android Kotlin Implementation (MainActivity.kt)', () => {
    it('enables window lockscreen and wake-up flags in onCreate', () => {
      expect(mainActivityContent).toContain('setShowWhenLocked(true)');
      expect(mainActivityContent).toContain('setTurnScreenOn(true)');
      expect(mainActivityContent).toContain('FLAG_SHOW_WHEN_LOCKED');
      expect(mainActivityContent).toContain('FLAG_TURN_SCREEN_ON');
      expect(mainActivityContent).toContain('FLAG_KEEP_SCREEN_ON');
    });

    it('creates high-priority incoming call NotificationChannel with Ringtone and Vibration', () => {
      expect(mainActivityContent).toContain('CALL_NOTIFICATION_CHANNEL_ID = "sovra_incoming_calls"');
      expect(mainActivityContent).toContain('NotificationManager.IMPORTANCE_HIGH');
      expect(mainActivityContent).toContain('NotificationCompat.VISIBILITY_PUBLIC');
      expect(mainActivityContent).toContain('RingtoneManager.TYPE_RINGTONE');
      expect(mainActivityContent).toContain('createCallNotificationChannel()');
    });

    it('implements displayIncomingCallSystemNotification with FullScreenIntent and Accept/Decline action buttons', () => {
      expect(mainActivityContent).toContain('fun displayIncomingCallSystemNotification(');
      expect(mainActivityContent).toContain('.setFullScreenIntent(fullScreenPendingIntent, true)');
      expect(mainActivityContent).toContain('"🟢 Accept"');
      expect(mainActivityContent).toContain('"🔴 Decline"');
      expect(mainActivityContent).toContain('ACQUIRE_CAUSES_WAKEUP');
      expect(mainActivityContent).toContain('dismissIncomingCallSystemNotification(');
    });

    it('bridges SovraCallNative into JavaScript runtime and handles onNewIntent actions', () => {
      expect(mainActivityContent).toContain('addJavascriptInterface(callBridge, "SovraCallNative")');
      expect(mainActivityContent).toContain('class SovraCallJsBridge(');
      expect(mainActivityContent).toContain('fun showIncomingCallNotification(');
      expect(mainActivityContent).toContain('fun cancelIncomingCallNotification(');
      expect(mainActivityContent).toContain('fun onNewIntent(intent: Intent)');
      expect(mainActivityContent).toContain('window.autoAnswerIncomingCallById');
      expect(mainActivityContent).toContain('window.declineIncomingCall');
    });
  });

  describe('3. PWA Service Worker Lockscreen Incoming Call Delivery', () => {
    it('handles SHOW_INCOMING_CALL_NOTIFICATION with interactive accept & decline actions', () => {
      expect(devServerContent).toContain("event.data.type === 'SHOW_INCOMING_CALL_NOTIFICATION'");
      expect(devServerContent).toContain("action: 'accept'");
      expect(devServerContent).toContain("title: '🟢 Accept'");
      expect(devServerContent).toContain("action: 'decline'");
      expect(devServerContent).toContain("title: '🔴 Decline'");
      expect(devServerContent).toContain("event.data.type === 'CANCEL_INCOMING_CALL_NOTIFICATION'");
    });

    it('routes notificationclick to direct accept and decline flows', () => {
      expect(devServerContent).toContain("action === 'accept'");
      expect(devServerContent).toContain('?autoAnswerCall=');
      expect(devServerContent).toContain("type: 'SOVRA_AUTO_ANSWER_CALL'");
      expect(devServerContent).toContain("action === 'decline'");
      expect(devServerContent).toContain("/api/call/end");
    });
  });

  describe('4. Dev Server Client Call Engine Integrity', () => {
    it('does NOT block pollIncomingCalls when document is hidden / screen is locked', () => {
      // Find pollIncomingCalls function
      const pollFnIdx = devServerContent.indexOf('function pollIncomingCalls()');
      expect(pollFnIdx).toBeGreaterThan(0);
      const pollFnSlice = devServerContent.slice(pollFnIdx, pollFnIdx + 300);
      // Ensure document.hidden does NOT gate the poll
      expect(pollFnSlice).not.toContain('if (document.hidden');
      expect(pollFnSlice).toContain('/api/call/incoming');
    });

    it('listens for call_invite SSE signals and dispatches system incoming call notifications', () => {
      expect(devServerContent).toContain("data.type === 'call_invite'");
      expect(devServerContent).toContain('window.dispatchSystemIncomingCallNotification');
      expect(devServerContent).toContain("data.type === 'call_hangup' || data.type === 'call_reject'");
      expect(devServerContent).toContain('window.dismissSystemIncomingCallNotification');
    });

    it('implements dispatchSystemIncomingCallNotification with Screen WakeLock, Vibration, and Native Bridge', () => {
      expect(devServerContent).toContain('function dispatchSystemIncomingCallNotification(inc)');
      expect(devServerContent).toContain('requestCallScreenWakeLock()');
      expect(devServerContent).toContain('startCallVibration()');
      expect(devServerContent).toContain('window.SovraCallNative.showIncomingCallNotification');
      expect(devServerContent).toContain('function dismissSystemIncomingCallNotification(callId)');
      expect(devServerContent).toContain('releaseCallScreenWakeLock()');
      expect(devServerContent).toContain('stopCallVibration()');
    });

    it('implements autoAnswerIncomingCallById for lockscreen auto-answer transitions', () => {
      expect(devServerContent).toContain('async function autoAnswerIncomingCallById(targetCallId)');
      expect(devServerContent).toContain('window.autoAnswerIncomingCallById = autoAnswerIncomingCallById;');
      expect(devServerContent).toContain('acceptIncomingCall()');
    });
  });

  describe('5. Mobile App Root Super-App Integration (apps/sovra-mobile)', () => {
    it('exports calling methods and types in mobile api.ts', () => {
      expect(mobileApiContent).toContain('export interface MobileIncomingCall');
      expect(mobileApiContent).toContain('export async function fetchIncomingCall()');
      expect(mobileApiContent).toContain('export async function declineCall(callId: string)');
      expect(mobileApiContent).toContain('export async function endCall(callId: string');
      expect(mobileApiContent).toContain('export async function answerCall(');
    });

    it('implements background incoming call listener in BottomTabNavigator across tabs', () => {
      expect(bottomNavContent).toContain('const [incomingCall, setIncomingCall] = useState<MobileIncomingCall | null>(null);');
      expect(bottomNavContent).toContain('const [activeCallSession, setActiveCallSession] = useState<');
      expect(bottomNavContent).toContain('fetchIncomingCall()');
      expect(bottomNavContent).toContain('navigator.wakeLock.request');
      expect(bottomNavContent).toContain('navigator.vibrate');
      expect(bottomNavContent).toContain('SovraCallNative.showIncomingCallNotification');
    });

    it('exposes autoAnswerIncomingCallById and declineIncomingCall globally on window for native bridge', () => {
      expect(bottomNavContent).toContain('(window as any).autoAnswerIncomingCallById = handleAutoAnswer;');
      expect(bottomNavContent).toContain('(window as any).declineIncomingCall = handleDecline;');
      expect(bottomNavContent).toContain("urlParams.get('autoAnswerCall')");
      expect(bottomNavContent).toContain("event.data?.type === 'SOVRA_AUTO_ANSWER_CALL'");
    });

    it('renders WhatsApp-style heads-up incoming call overlay and root CallScreen', () => {
      expect(bottomNavContent).toContain('id="mobileIncomingCallOverlay"');
      expect(bottomNavContent).toContain('id="btnAcceptIncomingCall"');
      expect(bottomNavContent).toContain('id="btnDeclineIncomingCall"');
      expect(bottomNavContent).toContain('handleAcceptIncomingCall');
      expect(bottomNavContent).toContain('handleDeclineIncomingCall');
      expect(bottomNavContent).toContain('<CallScreen');
      expect(bottomNavContent).toContain('peerName={activeCallSession.peerName}');
    });
  });
});
