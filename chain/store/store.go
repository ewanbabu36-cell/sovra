package store

import (
	"bytes"
	"os"
	"sync"

	"github.com/cockroachdb/pebble"
)

// KVStore represents a key-value store interface
type KVStore interface {
	Get(key []byte) []byte
	Set(key, value []byte)
	Delete(key []byte)
	Has(key []byte) bool
	Iterator(prefix []byte) Iterator
	CacheWrap() (KVStore, func())
	Close() error
}

// BatchWriter defines an interface for stores capable of atomic batch writes
type BatchWriter interface {
	ApplyBatch(sets map[string][]byte, deletes map[string]bool) error
}

// PebbleStore is a persistent KVStore implementation backed by CockroachDB Pebble
type PebbleStore struct {
	mu  sync.RWMutex
	db  *pebble.DB
	dir string
}

// NewPebbleStore initializes and opens a Pebble key-value database at dir
func NewPebbleStore(dir string) (*PebbleStore, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	opts := &pebble.Options{}
	db, err := pebble.Open(dir, opts)
	if err != nil {
		return nil, err
	}
	return &PebbleStore{
		db:  db,
		dir: dir,
	}, nil
}

func (s *PebbleStore) Get(key []byte) []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil
	}
	val, closer, err := s.db.Get(key)
	if err != nil {
		return nil
	}
	defer closer.Close()

	cp := make([]byte, len(val))
	copy(cp, val)
	return cp
}

func (s *PebbleStore) Set(key, value []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		panic("pebble database is closed")
	}
	if err := s.db.Set(key, value, pebble.Sync); err != nil {
		panic(err)
	}
}

func (s *PebbleStore) Delete(key []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		panic("pebble database is closed")
	}
	if err := s.db.Delete(key, pebble.Sync); err != nil {
		panic(err)
	}
}

func (s *PebbleStore) Has(key []byte) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return false
	}
	_, closer, err := s.db.Get(key)
	if err != nil {
		return false
	}
	_ = closer.Close()
	return true
}

func (s *PebbleStore) ApplyBatch(sets map[string][]byte, deletes map[string]bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		panic("pebble database is closed")
	}
	batch := s.db.NewBatch()
	defer batch.Close()

	for kStr := range deletes {
		if err := batch.Delete([]byte(kStr), nil); err != nil {
			return err
		}
	}
	for kStr, val := range sets {
		if err := batch.Set([]byte(kStr), val, nil); err != nil {
			return err
		}
	}

	return batch.Commit(pebble.Sync)
}

func (s *PebbleStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

func (s *PebbleStore) CacheWrap() (KVStore, func()) {
	cache := NewCacheStore(s)
	commit := func() {
		cache.Write()
	}
	return cache, commit
}

type pebbleIterator struct {
	iter   *pebble.Iterator
	prefix []byte
}

func (it *pebbleIterator) Valid() bool {
	return it.iter.Valid() && bytes.HasPrefix(it.iter.Key(), it.prefix)
}

func (it *pebbleIterator) Next() {
	it.iter.Next()
}

func (it *pebbleIterator) Key() []byte {
	if !it.Valid() {
		return nil
	}
	k := it.iter.Key()
	cp := make([]byte, len(k))
	copy(cp, k)
	return cp
}

func (it *pebbleIterator) Value() []byte {
	if !it.Valid() {
		return nil
	}
	v := it.iter.Value()
	cp := make([]byte, len(v))
	copy(cp, v)
	return cp
}

func (it *pebbleIterator) Close() {
	if it.iter != nil {
		_ = it.iter.Close()
	}
}

type emptyIterator struct{}

func (e *emptyIterator) Valid() bool   { return false }
func (e *emptyIterator) Next()         {}
func (e *emptyIterator) Key() []byte   { return nil }
func (e *emptyIterator) Value() []byte { return nil }
func (e *emptyIterator) Close()        {}

func (s *PebbleStore) Iterator(prefix []byte) Iterator {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return &emptyIterator{}
	}

	iter, err := s.db.NewIter(nil)
	if err != nil {
		return &emptyIterator{}
	}
	if len(prefix) > 0 {
		iter.SeekGE(prefix)
	} else {
		iter.First()
	}
	return &pebbleIterator{iter: iter, prefix: prefix}
}

// MemoryStore is an in-memory thread-safe implementation of KVStore
type MemoryStore struct {
	mu   sync.RWMutex
	data map[string][]byte
}

// NewMemoryStore creates a new in-memory KVStore
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		data: make(map[string][]byte),
	}
}

func (s *MemoryStore) Get(key []byte) []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()
	val, ok := s.data[string(key)]
	if !ok {
		return nil
	}
	cp := make([]byte, len(val))
	copy(cp, val)
	return cp
}

func (s *MemoryStore) Set(key, value []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := make([]byte, len(value))
	copy(cp, value)
	s.data[string(key)] = cp
}

func (s *MemoryStore) Delete(key []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, string(key))
}

func (s *MemoryStore) Has(key []byte) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.data[string(key)]
	return ok
}

func (s *MemoryStore) Close() error {
	return nil
}

// CacheWrap creates an isolated write-back cache context matching Cosmos SDK CacheContext semantics.
// Any writes to cache are private until commit() is explicitly executed.
func (s *MemoryStore) CacheWrap() (KVStore, func()) {
	cache := NewCacheStore(s)
	commit := func() {
		cache.Write()
	}
	return cache, commit
}

// CacheStore is a write-back cache wrapping a parent KVStore
type CacheStore struct {
	parent  KVStore
	mu      sync.RWMutex
	cache   map[string][]byte
	deleted map[string]bool
}

func NewCacheStore(parent KVStore) *CacheStore {
	return &CacheStore{
		parent:  parent,
		cache:   make(map[string][]byte),
		deleted: make(map[string]bool),
	}
}

func (c *CacheStore) Get(key []byte) []byte {
	c.mu.RLock()
	defer c.mu.RUnlock()
	kStr := string(key)
	if c.deleted[kStr] {
		return nil
	}
	if val, ok := c.cache[kStr]; ok {
		cp := make([]byte, len(val))
		copy(cp, val)
		return cp
	}
	return c.parent.Get(key)
}

func (c *CacheStore) Set(key, value []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	kStr := string(key)
	delete(c.deleted, kStr)
	cp := make([]byte, len(value))
	copy(cp, value)
	c.cache[kStr] = cp
}

func (c *CacheStore) Delete(key []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	kStr := string(key)
	delete(c.cache, kStr)
	c.deleted[kStr] = true
}

func (c *CacheStore) Has(key []byte) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	kStr := string(key)
	if c.deleted[kStr] {
		return false
	}
	if _, ok := c.cache[kStr]; ok {
		return true
	}
	return c.parent.Has(key)
}

func (c *CacheStore) CacheWrap() (KVStore, func()) {
	child := NewCacheStore(c)
	commit := func() {
		child.Write()
	}
	return child, commit
}

func (c *CacheStore) Close() error {
	return nil
}

// Write commits all buffered writes and deletes into the parent store atomically
func (c *CacheStore) Write() {
	c.mu.Lock()
	defer c.mu.Unlock()

	// If parent supports atomic batch writes, use it
	if bw, ok := c.parent.(BatchWriter); ok {
		if err := bw.ApplyBatch(c.cache, c.deleted); err != nil {
			panic(err)
		}
	} else {
		for kStr := range c.deleted {
			c.parent.Delete([]byte(kStr))
		}
		for kStr, val := range c.cache {
			c.parent.Set([]byte(kStr), val)
		}
	}

	// Clear cache
	c.cache = make(map[string][]byte)
	c.deleted = make(map[string]bool)
}

type Iterator interface {
	Valid() bool
	Next()
	Key() []byte
	Value() []byte
	Close()
}

type mapIterator struct {
	keys   [][]byte
	values [][]byte
	idx    int
}

func (it *mapIterator) Valid() bool   { return it.idx < len(it.keys) }
func (it *mapIterator) Next()         { it.idx++ }
func (it *mapIterator) Key() []byte   { return it.keys[it.idx] }
func (it *mapIterator) Value() []byte { return it.values[it.idx] }
func (it *mapIterator) Close()        {}

func (s *MemoryStore) Iterator(prefix []byte) Iterator {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var keys [][]byte
	var values [][]byte
	for kStr, v := range s.data {
		k := []byte(kStr)
		if bytes.HasPrefix(k, prefix) {
			keys = append(keys, k)
			values = append(values, v)
		}
	}
	return &mapIterator{keys: keys, values: values, idx: 0}
}

func (c *CacheStore) Iterator(prefix []byte) Iterator {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.parent.Iterator(prefix)
}
