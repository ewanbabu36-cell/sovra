package store_test

import (
	"bytes"
	"testing"

	"github.com/sovra/chain/store"
)

func TestDataPersistenceAcrossReopen(t *testing.T) {
	dir := t.TempDir()

	// 1. Open persistent store, write initial state, and close
	db1, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to open pebble store: %v", err)
	}

	db1.Set([]byte("account:alice"), []byte("1000000"))
	db1.Set([]byte("account:bob"), []byte("2000000"))
	db1.Set([]byte("chain:height"), []byte("42"))

	if err := db1.Close(); err != nil {
		t.Fatalf("failed to close store: %v", err)
	}

	// 2. Reopen store from disk - verify data persisted completely
	db2, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to reopen pebble store: %v", err)
	}
	defer db2.Close()

	if !bytes.Equal(db2.Get([]byte("account:alice")), []byte("1000000")) {
		t.Fatalf("alice balance did not persist across close/reopen")
	}
	if !bytes.Equal(db2.Get([]byte("account:bob")), []byte("2000000")) {
		t.Fatalf("bob balance did not persist across close/reopen")
	}
	if !bytes.Equal(db2.Get([]byte("chain:height")), []byte("42")) {
		t.Fatalf("height did not persist across close/reopen")
	}

	// 3. Delete key and verify persistence across a 3rd reopen
	db2.Delete([]byte("account:bob"))
	if err := db2.Close(); err != nil {
		t.Fatalf("failed to close store: %v", err)
	}

	db3, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to reopen pebble store 3rd time: %v", err)
	}
	defer db3.Close()

	if db3.Has([]byte("account:bob")) {
		t.Fatalf("deleted key account:bob still exists on disk")
	}
	if !bytes.Equal(db3.Get([]byte("account:alice")), []byte("1000000")) {
		t.Fatalf("account:alice should still exist")
	}
}

func TestCacheWrapRollbackDoesNotTouchDisk(t *testing.T) {
	dir := t.TempDir()

	db, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to open pebble store: %v", err)
	}

	// Set baseline data
	db.Set([]byte("account:alice"), []byte("500000"))

	// Create CacheWrap sandbox
	cache, _ := db.CacheWrap()

	// Perform dirty writes in sandbox
	cache.Set([]byte("account:alice"), []byte("999999999")) // Dirty update
	cache.Set([]byte("account:hacker"), []byte("100000000")) // Dirty insert
	cache.Delete([]byte("account:alice"))                     // Dirty delete

	// SIMULATE TRANSACTION REVERT / FAILURE:
	// commit() is NOT called!

	// Verify root disk store in memory handle is 100% clean
	if !bytes.Equal(db.Get([]byte("account:alice")), []byte("500000")) {
		t.Fatalf("root store corrupted: alice was modified before commit")
	}
	if db.Has([]byte("account:hacker")) {
		t.Fatalf("root store corrupted: hacker key was written before commit")
	}

	// Close and reopen from disk to verify physical files on disk were untouched
	if err := db.Close(); err != nil {
		t.Fatalf("failed to close: %v", err)
	}

	reopened, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to reopen: %v", err)
	}
	defer reopened.Close()

	if !bytes.Equal(reopened.Get([]byte("account:alice")), []byte("500000")) {
		t.Fatalf("disk corrupted after rollback: alice expected 500000, got %s", reopened.Get([]byte("account:alice")))
	}
	if reopened.Has([]byte("account:hacker")) {
		t.Fatalf("disk corrupted: uncommitted hacker account exists on disk")
	}
}

func TestCacheWrapCommitPersistsToDisk(t *testing.T) {
	dir := t.TempDir()

	db, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to open pebble store: %v", err)
	}

	db.Set([]byte("account:alice"), []byte("500000"))

	// Create CacheWrap sandbox
	cache, commit := db.CacheWrap()
	cache.Set([]byte("account:alice"), []byte("400000"))
	cache.Set([]byte("account:bob"), []byte("100000"))

	// Explicitly commit atomic batch
	commit()

	// Verify immediately
	if !bytes.Equal(db.Get([]byte("account:alice")), []byte("400000")) {
		t.Fatalf("expected alice=400000")
	}
	if !bytes.Equal(db.Get([]byte("account:bob")), []byte("100000")) {
		t.Fatalf("expected bob=100000")
	}

	// Close and reopen to verify disk persistence
	if err := db.Close(); err != nil {
		t.Fatalf("failed to close: %v", err)
	}

	reopened, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to reopen: %v", err)
	}
	defer reopened.Close()

	if !bytes.Equal(reopened.Get([]byte("account:alice")), []byte("400000")) {
		t.Fatalf("committed alice write did not persist to disk")
	}
	if !bytes.Equal(reopened.Get([]byte("account:bob")), []byte("100000")) {
		t.Fatalf("committed bob write did not persist to disk")
	}
}

func TestPebbleIteratorPrefix(t *testing.T) {
	dir := t.TempDir()

	db, err := store.NewPebbleStore(dir)
	if err != nil {
		t.Fatalf("failed to open pebble store: %v", err)
	}
	defer db.Close()

	db.Set([]byte("item/a"), []byte("valA"))
	db.Set([]byte("item/b"), []byte("valB"))
	db.Set([]byte("item/c"), []byte("valC"))
	db.Set([]byte("other/z"), []byte("valZ"))

	iter := db.Iterator([]byte("item/"))
	defer iter.Close()

	var visitedKeys []string
	for ; iter.Valid(); iter.Next() {
		visitedKeys = append(visitedKeys, string(iter.Key()))
	}

	if len(visitedKeys) != 3 {
		t.Fatalf("expected 3 items with prefix 'item/', got %d: %v", len(visitedKeys), visitedKeys)
	}
	if visitedKeys[0] != "item/a" || visitedKeys[1] != "item/b" || visitedKeys[2] != "item/c" {
		t.Fatalf("unexpected order or keys: %v", visitedKeys)
	}
}
