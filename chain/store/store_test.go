package store_test

import (
	"bytes"
	"testing"

	"github.com/sovra/chain/store"
)

func TestCacheWrapCommitAndRollback(t *testing.T) {
	root := store.NewMemoryStore()

	root.Set([]byte("key1"), []byte("value1"))

	// 1. Successful transaction: commit() called
	cache1, commit1 := root.CacheWrap()
	cache1.Set([]byte("key1"), []byte("value1_updated"))
	cache1.Set([]byte("key2"), []byte("value2"))
	commit1()

	if !bytes.Equal(root.Get([]byte("key1")), []byte("value1_updated")) {
		t.Fatalf("expected updated value in root store")
	}
	if !bytes.Equal(root.Get([]byte("key2")), []byte("value2")) {
		t.Fatalf("expected key2 in root store")
	}

	// 2. Aborted / Failing transaction: commit() NOT called (Rollback)
	cache2, _ := root.CacheWrap()
	cache2.Set([]byte("key1"), []byte("corrupted_value"))
	cache2.Set([]byte("key3"), []byte("unwanted_value"))
	cache2.Delete([]byte("key2"))
	// Simulation of error: commit() dropped!

	// Verify root remains completely unaffected
	if !bytes.Equal(root.Get([]byte("key1")), []byte("value1_updated")) {
		t.Fatalf("rollback failed: key1 was mutated")
	}
	if !bytes.Equal(root.Get([]byte("key2")), []byte("value2")) {
		t.Fatalf("rollback failed: key2 was deleted")
	}
	if root.Has([]byte("key3")) {
		t.Fatalf("rollback failed: key3 was written")
	}
}
