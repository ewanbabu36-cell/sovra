/**
 * @file apps/sovra-mobile/src/components/QrScannerModal.tsx
 * Native Webcam & Mobile Barcode Camera Scanner Modal.
 *
 * Implements:
 * 1. navigator.mediaDevices.getUserMedia live video stream.
 * 2. High-performance BarcodeDetector API scanning loop.
 * 3. Graceful fallback for file upload / manual paste when camera permissions denied.
 * 4. Automatic parsing of `sovra:<address>?amount=<val>&token=SOV` payment URIs.
 */

import React, { useState, useEffect, useRef } from 'react';
import { parseSovraUri } from './QrCodeRenderer';

export interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (result: { address: string; amount?: string; token?: string }) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');

  useEffect(() => {
    let active = true;

    async function startCamera() {
      if (!isOpen) return;
      setCameraError(null);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('Webcam / camera hardware is not available on this device environment.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setCameraActive(true);
        }

        // Start scanning with BarcodeDetector if available
        if ('BarcodeDetector' in window) {
          try {
            const barcodeDetector = new (window as any).BarcodeDetector({
              formats: ['qr_code'],
            });

            const scanInterval = setInterval(async () => {
              if (!active || !videoRef.current || videoRef.current.readyState < 2) return;
              try {
                const barcodes = await barcodeDetector.detect(videoRef.current);
                if (barcodes && barcodes.length > 0) {
                  const rawValue = barcodes[0].rawValue;
                  clearInterval(scanInterval);
                  const parsed = parseSovraUri(rawValue);
                  onScanSuccess(parsed);
                  onClose();
                }
              } catch {}
            }, 300);

          } catch {}
        }
      } catch (err: any) {
        if (active) {
          setCameraError(
            err.name === 'NotAllowedError'
              ? 'Camera permission denied. Please allow camera access in browser settings.'
              : `Camera error: ${err.message || err}`,
          );
        }
      }
    }

    if (isOpen) {
      startCamera();
    }

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      setCameraActive(false);
    };
  }, [isOpen, onClose, onScanSuccess]);

  if (!isOpen) return null;

  const handleManualSubmit = () => {
    if (!manualInput.trim()) return;
    const parsed = parseSovraUri(manualInput.trim());
    onScanSuccess(parsed);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(12px)',
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#0f172a',
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.15)',
          padding: 24,
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 25px 50px rgba(0,0,0,0.85)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          color: '#f8fafc',
          textAlign: 'center',
        }}
      >
        {/* Header */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📷</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Scan QR Code</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Viewfinder Viewport */}
        <div
          style={{
            position: 'relative',
            width: 260,
            height: 260,
            backgroundColor: '#000',
            borderRadius: 20,
            overflow: 'hidden',
            border: '2px solid #38bdf8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 30px rgba(56, 189, 248, 0.3)',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />

          {/* Scanner Targeting Corners */}
          <div
            style={{
              position: 'absolute',
              inset: 20,
              border: '2px dashed rgba(255,255,255,0.4)',
              borderRadius: 14,
              pointerEvents: 'none',
            }}
          />

          {!cameraActive && !cameraError && (
            <div style={{ position: 'absolute', fontSize: 12, color: '#94a3b8' }}>
              Starting Camera Preview...
            </div>
          )}

          {cameraError && (
            <div style={{ position: 'absolute', inset: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(15,23,42,0.92)' }}>
              <span style={{ fontSize: 24 }}>📷</span>
              <span style={{ fontSize: 11, color: '#f87171', padding: '0 8px' }}>
                {cameraError}
              </span>
            </div>
          )}
        </div>

        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          Point camera at any Sovra QR code or paste URI below:
        </div>

        {/* Fallback Manual URI Input */}
        <div style={{ width: '100%', display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            placeholder="sovra:sovra1... or did:key:..."
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 10,
              backgroundColor: '#1e293b',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          />
          <button
            type="button"
            onClick={handleManualSubmit}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              backgroundColor: '#00a884',
              color: '#fff',
              border: 'none',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
