/**
 * @file tests/e2e/webrtc-call-camera-flip-and-incall-chat.test.ts
 * SOVRA WEBRTC CALL CAMERA FLIP, IN-CALL CHAT DRAWER & OFFLINE BLE MESH TEST SUITE
 *
 * Verifies:
 * 1. Video call UI contains Front/Rear Camera Flip control (#callFlipCamBtn, #callFlipCamBtn / flipCallCamera())
 * 2. Video call UI contains In-Call Real-Time Chat drawer (#callInCallChatBtn, #inCallChatDrawer, #inCallMessagesList, #inCallTextInput, #inCallSendBtn)
 * 3. Video call UI contains "Open Full Chat (PiP)" minimization button (#callMinimizeToChatBtn)
 * 4. Client engine implements flipCallCamera with facingMode user/environment switching and scaleX mirroring
 * 5. Client engine implements toggleInCallChat, sendInCallMessage, renderInCallMessages, minimizeCallToFullChat
 * 6. Offline BLE Mesh Radar (SovraBleMeshRadar) implements persistent localStorage caching and autonomous peer discovery
 * 7. Offline network pill styling displays non-alarming "Offline Mesh Active — Bluetooth GATT & DTN Outbox Ready"
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('WebRTC Call Camera Flip, In-Call Chat & Offline BLE Mesh Integrity', () => {
  const devServerPath = path.resolve(process.cwd(), 'scripts/dev-server.ts');
  const devServerContent = fs.readFileSync(devServerPath, 'utf8');

  it('contains camera flip UI button and handler for E2EE video calling', () => {
    // E2EE Call Modal Flip Camera button
    expect(devServerContent).toContain('id="callFlipCamBtn"');
    expect(devServerContent).toContain('flipCallCamera()');
    expect(devServerContent).toContain('title="Flip Camera (Front/Back)"');
  });

  it('contains in-call real-time chat drawer and PiP minimization controls', () => {
    // In-Call Chat toggle button
    expect(devServerContent).toContain('id="callInCallChatBtn"');
    expect(devServerContent).toContain('toggleInCallChat()');
    expect(devServerContent).toContain('title="In-Call Text Chat"');

    // In-Call Chat Drawer container
    expect(devServerContent).toContain('id="inCallChatDrawer"');
    expect(devServerContent).toContain('id="inCallMessagesList"');
    expect(devServerContent).toContain('id="inCallTextInput"');
    expect(devServerContent).toContain('id="inCallSendBtn"');
    expect(devServerContent).toContain('id="btnMinimizeCallToChat"');
    expect(devServerContent).toContain('minimizeCallToFullChat()');
  });

  it('implements flipCallCamera with facingMode switching and mirror transformations', () => {
    expect(devServerContent).toContain('async function flipCallCamera()');
    expect(devServerContent).toContain("const targetFacing = (window._callFacingMode === 'user' ? 'environment' : 'user')");
    expect(devServerContent).toContain('navigator.mediaDevices.getUserMedia(');
    expect(devServerContent).toContain('facingMode: { ideal: targetFacing }');
    expect(devServerContent).toContain('videoSender.replaceTrack(newTrack)');
    expect(devServerContent).toContain("const scaleCss = isUser ? 'scaleX(-1)' : 'scaleX(1)'");
    expect(devServerContent).toContain('localFeed.style.transform = scaleCss;');
    expect(devServerContent).toContain('window.flipCallCamera = flipCallCamera;');
  });

  it('implements in-call text chat messaging engine and PiP minimization', () => {
    expect(devServerContent).toContain('function toggleInCallChat(');
    expect(devServerContent).toContain('function renderInCallMessages()');
    expect(devServerContent).toContain('function sendInCallMessage()');
    expect(devServerContent).toContain('function minimizeCallToFullChat()');

    // Multi-channel dispatch: DataChannel, server persistence, and offline outbox
    expect(devServerContent).toContain("type: 'in_call_chat'");
    expect(devServerContent).toContain('/api/chat/send');
    expect(devServerContent).toContain("window.SovraOfflineOutbox.getInstance().enqueue('SEND_MESSAGE'");

    // Window globals exported
    expect(devServerContent).toContain('window.toggleInCallChat = toggleInCallChat;');
    expect(devServerContent).toContain('window.sendInCallMessage = sendInCallMessage;');
    expect(devServerContent).toContain('window.minimizeCallToFullChat = minimizeCallToFullChat;');
  });

  it('implements resilient Offline BLE Mesh Radar with persistent caching and autonomous peer recovery', () => {
    expect(devServerContent).toContain('window.SovraBleMeshRadar = {');
    expect(devServerContent).toContain('sovra_ble_mesh_peers_v1');
    expect(devServerContent).toContain('sovra_ble_outbox_v1');
    expect(devServerContent).toContain("localStorage.getItem('sovra_ble_mesh_peers_v1')");
    expect(devServerContent).toContain("localStorage.getItem('sovra_ble_outbox_v1')");
    expect(devServerContent).toContain('did:sovra:ble:alice9988');
    expect(devServerContent).toContain('did:sovra:ble:bob1122');
    expect(devServerContent).toContain('did:sovra:ble:metro_relay');
  });

  it('displays non-alarming mesh purple/indigo gradient pill when operating offline', () => {
    expect(devServerContent).toContain('linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(168, 85, 247, 0.95))');
    expect(devServerContent).toContain('Offline Mesh Active — Bluetooth GATT &amp; DTN Outbox Ready');
    expect(devServerContent).toContain('Operating in Offline Mesh Mode (Bluetooth GATT & DTN Store-and-Forward Active)');
  });
});
