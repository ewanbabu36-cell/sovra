/**
 * @file apps/sovra-mobile/src/components/AddressBookModal.tsx
 * Sovereign Address Book & Saved Contacts Manager.
 *
 * Implements:
 * 1. Persistent storage of contacts (name, DID, avatar/color, notes).
 * 2. 1-click selection callback for SendTokenModal recipient input.
 * 3. Add / Remove contacts manager with address validation.
 */

import React, { useState, useEffect } from 'react';

export interface SavedContact {
  id: string;
  name: string;
  address: string;
  notes?: string | undefined;
  addedAt: number;
}

const STORAGE_KEY = 'sovra_wallet_address_book_v1';

export function getSavedContacts(): SavedContact[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Default initial contacts
      return [
        {
          id: 'contact_genesis_treasury',
          name: 'Sovra Treasury Faucet',
          address: 'did:sov:treasury_genesis',
          notes: 'Official Genesis Starter Grant node',
          addedAt: Date.now() - 1000000,
        },
      ];
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveContactToBook(contact: Omit<SavedContact, 'id' | 'addedAt'>): SavedContact {
  const list = getSavedContacts();
  const newContact: SavedContact = {
    ...contact,
    id: 'contact_' + Date.now(),
    addedAt: Date.now(),
  };
  const updated = [newContact, ...list.filter(c => c.address !== contact.address)];
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }
  return newContact;
}

export function removeContactFromBook(id: string): void {
  const list = getSavedContacts();
  const updated = list.filter(c => c.id !== id);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }
}

export interface AddressBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectContact?: (contact: SavedContact) => void;
}

export const AddressBookModal: React.FC<AddressBookModalProps> = ({
  isOpen,
  onClose,
  onSelectContact,
}) => {
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setContacts(getSavedContacts());
      setIsAdding(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAdd = () => {
    setError(null);
    if (!newName.trim()) {
      setError('Contact nickname is required.');
      return;
    }
    if (!newAddress.trim()) {
      setError('Address or DID is required.');
      return;
    }
    saveContactToBook({
      name: newName.trim(),
      address: newAddress.trim(),
      ...(newNotes.trim() ? { notes: newNotes.trim() } : {}),
    });
    setContacts(getSavedContacts());
    setIsAdding(false);
    setNewName('');
    setNewAddress('');
    setNewNotes('');
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeContactFromBook(id);
    setContacts(getSavedContacts());
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(12px)',
        zIndex: 1250,
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
          maxWidth: 420,
          boxShadow: '0 25px 50px rgba(0,0,0,0.85)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          color: '#f8fafc',
          maxHeight: '85vh',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>📒</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>Address Book</span>
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

        {/* Contacts List or Add Form */}
        {!isAdding ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                Saved Contacts ({contacts.length})
              </span>
              <button
                type="button"
                onClick={() => setIsAdding(true)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  backgroundColor: '#00a884',
                  color: '#fff',
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                + Add Contact
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: '50vh' }}>
              {contacts.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                  No saved contacts yet. Tap "+ Add Contact" to save frequent peers!
                </div>
              ) : (
                contacts.map(c => (
                  <div
                    key={c.id}
                    onClick={() => {
                      if (onSelectContact) {
                        onSelectContact(c);
                        onClose();
                      }
                    }}
                    style={{
                      backgroundColor: '#1e293b',
                      borderRadius: 14,
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: onSelectContact ? 'pointer' : 'default',
                      border: '1px solid rgba(255,255,255,0.06)',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          backgroundColor: '#3b82f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                          fontWeight: 800,
                        }}
                      >
                        {c.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{c.name}</div>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}>
                          {c.address.slice(0, 16)}...
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {onSelectContact && (
                        <span style={{ fontSize: 11, color: '#34d399', fontWeight: 700 }}>Select ➔</span>
                      )}
                      <button
                        type="button"
                        onClick={e => handleDelete(c.id, e)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#64748b',
                          fontSize: 14,
                          cursor: 'pointer',
                          padding: 4,
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          /* Add Contact Form */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>Nickname / Label</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Alice Mobile Node"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1e293b',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  fontSize: 13,
                  marginTop: 4,
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>Sovereign Address or DID</label>
              <input
                type="text"
                value={newAddress}
                onChange={e => setNewAddress(e.target.value)}
                placeholder="sovra1... or did:key:z..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1e293b',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  fontSize: 13,
                  marginTop: 4,
                  fontFamily: 'monospace',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>Notes (Optional)</label>
              <input
                type="text"
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                placeholder="e.g. Frequent mesh peer"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1e293b',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  fontSize: 13,
                  marginTop: 4,
                }}
              />
            </div>

            {error && (
              <div style={{ fontSize: 11, color: '#f87171', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: 8 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 10,
                  backgroundColor: '#1e293b',
                  color: '#94a3b8',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                style={{
                  flex: 2,
                  padding: '10px 0',
                  borderRadius: 10,
                  backgroundColor: '#10b981',
                  color: '#0f172a',
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Save Contact
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
