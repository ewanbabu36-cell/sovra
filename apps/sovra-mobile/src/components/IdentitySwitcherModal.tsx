/**
 * @file apps/sovra-mobile/src/components/IdentitySwitcherModal.tsx
 * Horizon Identity Switcher Bottom Sheet & Header Identity Pill for Sovra Mobile.
 *
 * Implements Airtel Thanks & Telegram-style multi-account / persona switching:
 * 1. Sticky/Header Identity Pill ([👤 Active Persona ▾]) showing active handle & role badge.
 * 2. Slide-up Horizon Identity Bottom Sheet (#identitySwitcherSheet).
 * 3. 1-Tap Scoped Persona Transitions across:
 *    - Citizen Profile (Personal DID, P2P wallet)
 *    - Owned Broadcast Channels (Studio Pro, 14.2k subscribers)
 *    - B2B Organizations / DAOs (Org Admin)
 * 4. Fast Add Persona / Channel action.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { localDb } from '../services/local-database.js';

export interface SovereignPersona {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly role: string;
  readonly type: 'citizen' | 'channel' | 'org';
  readonly avatar: string;
  readonly badgeText: string;
  readonly badgeColor: string;
  readonly subscribersCount?: number;
  readonly memberCount?: number;
}

export const DEFAULT_PERSONAS: SovereignPersona[] = [
  {
    id: 'citizen_primary',
    handle: '@alice_p2p',
    name: 'Alice (Citizen Node)',
    role: 'Citizen',
    type: 'citizen',
    avatar: '⚡',
    badgeText: 'Verified Citizen',
    badgeColor: '#10b981',
  },
  {
    id: 'channel_studio_pro',
    handle: '@sovra_studios',
    name: 'Sovra Studio Pro',
    role: 'Creator Pro',
    type: 'channel',
    avatar: '🎙️',
    badgeText: 'Channel (14.2k)',
    badgeColor: '#8b5cf6',
    subscribersCount: 14200,
  },
  {
    id: 'org_sovra_dao',
    handle: '@sovra_dao',
    name: 'Sovereign Protocol DAO',
    role: 'Org Admin',
    type: 'org',
    avatar: '🏛️',
    badgeText: 'B2B Org Admin',
    badgeColor: '#f59e0b',
    memberCount: 85,
  },
];

export interface IdentitySwitcherModalProps {
  readonly isOpen: boolean;
  readonly activePersonaId?: string;
  readonly personas?: SovereignPersona[];
  readonly onClose: () => void;
  readonly onSelectPersona?: (persona: SovereignPersona) => void;
  readonly onAddPersona?: () => void;
}

export function IdentitySwitcherModal({
  isOpen,
  activePersonaId = 'citizen_primary',
  personas = DEFAULT_PERSONAS,
  onClose,
  onSelectPersona,
  onAddPersona,
}: IdentitySwitcherModalProps): React.JSX.Element | null {
  const [selectedId, setSelectedId] = useState<string>(activePersonaId);

  useEffect(() => {
    setSelectedId(activePersonaId);
  }, [activePersonaId]);

  if (!isOpen) return null;

  const handleSelect = (persona: SovereignPersona) => {
    setSelectedId(persona.id);
    try {
      localDb.setActivePersona(persona);
    } catch {
      // fallback
    }
    if (onSelectPersona) {
      onSelectPersona(persona);
    }
    onClose();
  };

  return (
    <div
      id="identitySwitcherOverlay"
      data-testid="identitySwitcherOverlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        id="identitySwitcherSheet"
        data-testid="identitySwitcherSheet"
        className="identity-switcher-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '520px',
          background: 'linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          padding: '1.5rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.22)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          borderRight: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.6)',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          animation: 'slideUp 0.25s ease-out',
        }}
      >
        {/* Grab Handle */}
        <div
          style={{
            width: '44px',
            height: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.3)',
            borderRadius: '9999px',
            margin: '0 auto 1.25rem',
          }}
        />

        {/* Sheet Title Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>Horizon Identity Switcher</h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
              Switch personas instantly without logging out
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Persona Options List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {personas.map((persona) => {
            const isCurrent = persona.id === selectedId;
            return (
              <div
                key={persona.id}
                id={`personaItem-${persona.id}`}
                data-testid={`personaItem-${persona.id}`}
                onClick={() => handleSelect(persona)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: isCurrent
                    ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(139, 92, 246, 0.2) 100%)'
                    : 'rgba(255, 255, 255, 0.04)',
                  border: isCurrent
                    ? '1.5px solid #818cf8'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '16px',
                  padding: '0.85rem 1rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: 'rgba(255, 255, 255, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.35rem',
                    }}
                  >
                    {persona.avatar}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.92rem', color: '#f8fafc' }}>
                      {persona.name}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      {persona.handle}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      backgroundColor: `${persona.badgeColor}22`,
                      color: persona.badgeColor,
                      border: `1px solid ${persona.badgeColor}44`,
                      borderRadius: '9999px',
                      padding: '0.2rem 0.55rem',
                    }}
                  >
                    {persona.badgeText}
                  </span>
                  {isCurrent && (
                    <span style={{ color: '#10b981', fontSize: '1rem', fontWeight: 700 }}>✓</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Persona Action Button */}
        <button
          id="btnAddPersona"
          data-testid="btnAddPersona"
          onClick={() => {
            if (onAddPersona) onAddPersona();
          }}
          style={{
            width: '100%',
            padding: '0.75rem',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px dashed rgba(255, 255, 255, 0.2)',
            borderRadius: '14px',
            color: '#cbd5e1',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
          }}
        >
          <span>＋</span>
          <span>Create New Channel or Organization Page</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Header Identity Pill component to stick at top bar for opening Horizon Switcher
 */
export function HeaderIdentitySwitcherPill({
  activePersona = DEFAULT_PERSONAS[0],
  onOpen,
}: {
  readonly activePersona?: SovereignPersona;
  readonly onOpen: () => void;
}): React.JSX.Element {
  return (
    <button
      id="headerIdentitySwitcherPill"
      data-testid="headerIdentitySwitcherPill"
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.45rem',
        background: 'rgba(255, 255, 255, 0.08)',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        borderRadius: '9999px',
        padding: '0.3rem 0.75rem',
        color: '#f8fafc',
        cursor: 'pointer',
        fontSize: '0.82rem',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <span>{activePersona.avatar}</span>
      <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {activePersona.handle}
      </span>
      <span
        style={{
          fontSize: '0.65rem',
          backgroundColor: `${activePersona.badgeColor}33`,
          color: activePersona.badgeColor,
          padding: '0.1rem 0.4rem',
          borderRadius: '9999px',
        }}
      >
        {activePersona.role}
      </span>
      <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>▾</span>
    </button>
  );
}
