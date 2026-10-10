/**
 * @file apps/sovra-app/src/ui/sovra-communication/SovraCallSurface.ts
 * Spatial Call Surface State and WebRTC Controller Facade
 */

import { CallState, CallType } from './types.js';

export class SovraCallSurface {
  private currentState: CallState = 'idle';
  private callType: CallType = 'audio';
  private peerName: string = '';
  private durationSeconds: number = 0;
  private isMuted: boolean = false;
  private isVideoEnabled: boolean = false;

  public startCall(peerName: string, type: CallType): void {
    this.peerName = peerName;
    this.callType = type;
    this.currentState = 'signaling_offer';
    this.durationSeconds = 0;
    this.isMuted = false;
    this.isVideoEnabled = type === 'video';
  }

  public setConnected(): void {
    this.currentState = 'connected';
  }

  public endCall(): void {
    this.currentState = 'ended';
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  public toggleVideo(): boolean {
    this.isVideoEnabled = !this.isVideoEnabled;
    return this.isVideoEnabled;
  }

  public getState(): CallState {
    return this.currentState;
  }

  public getCallType(): CallType {
    return this.callType;
  }

  public getPeerName(): string {
    return this.peerName;
  }

  public getDurationFormatted(): string {
    const mins = Math.floor(this.durationSeconds / 60);
    const secs = this.durationSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  public incrementDuration(): number {
    this.durationSeconds += 1;
    return this.durationSeconds;
  }
}
