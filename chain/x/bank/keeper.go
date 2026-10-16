package bank

import (
	"fmt"

	"cosmossdk.io/math"
	"github.com/sovra/chain/store"
)

var (
	KeyPrefixBalance = []byte{0x10}
	KeyTotalSupply   = []byte{0x11}
)

func BalanceKey(addr string) []byte {
	return append(KeyPrefixBalance, []byte(addr)...)
}

func ModuleAccountAddress(moduleName string) string {
	return "sovra_module_" + moduleName
}

type Keeper struct{}

func NewKeeper() *Keeper {
	return &Keeper{}
}

func (k *Keeper) GetBalance(s store.KVStore, addr string) math.Int {
	bz := s.Get(BalanceKey(addr))
	if len(bz) == 0 {
		return math.ZeroInt()
	}
	var val math.Int
	if err := val.Unmarshal(bz); err != nil {
		return math.ZeroInt()
	}
	return val
}

func (k *Keeper) SetBalance(s store.KVStore, addr string, amount math.Int) {
	bz, err := amount.Marshal()
	if err != nil {
		panic(err)
	}
	s.Set(BalanceKey(addr), bz)
}

func (k *Keeper) GetTotalSupply(s store.KVStore) math.Int {
	bz := s.Get(KeyTotalSupply)
	if len(bz) == 0 {
		return math.ZeroInt()
	}
	var val math.Int
	if err := val.Unmarshal(bz); err != nil {
		return math.ZeroInt()
	}
	return val
}

func (k *Keeper) SetTotalSupply(s store.KVStore, amount math.Int) {
	bz, err := amount.Marshal()
	if err != nil {
		panic(err)
	}
	s.Set(KeyTotalSupply, bz)
}

func (k *Keeper) SendCoins(s store.KVStore, from string, to string, amount math.Int) error {
	if !amount.IsPositive() {
		return fmt.Errorf("amount must be positive")
	}
	fromBal := k.GetBalance(s, from)
	if fromBal.LT(amount) {
		return fmt.Errorf("insufficient balance: have %s, need %s", fromBal, amount)
	}
	k.SetBalance(s, from, fromBal.Sub(amount))
	toBal := k.GetBalance(s, to)
	k.SetBalance(s, to, toBal.Add(amount))
	return nil
}

func (k *Keeper) MintCoins(s store.KVStore, moduleName string, amount math.Int) error {
	if !amount.IsPositive() {
		return fmt.Errorf("mint amount must be positive")
	}
	macc := ModuleAccountAddress(moduleName)
	curBal := k.GetBalance(s, macc)
	k.SetBalance(s, macc, curBal.Add(amount))

	supply := k.GetTotalSupply(s)
	k.SetTotalSupply(s, supply.Add(amount))
	return nil
}

func (k *Keeper) BurnCoins(s store.KVStore, moduleName string, amount math.Int) error {
	if !amount.IsPositive() {
		return fmt.Errorf("burn amount must be positive")
	}
	macc := ModuleAccountAddress(moduleName)
	curBal := k.GetBalance(s, macc)
	if curBal.LT(amount) {
		return fmt.Errorf("module account has %s, cannot burn %s", curBal, amount)
	}
	k.SetBalance(s, macc, curBal.Sub(amount))

	supply := k.GetTotalSupply(s)
	if supply.LT(amount) {
		return fmt.Errorf("supply %s is less than burn amount %s", supply, amount)
	}
	k.SetTotalSupply(s, supply.Sub(amount))
	return nil
}

func (k *Keeper) SendCoinsFromModuleToAccount(s store.KVStore, moduleName string, recipient string, amount math.Int) error {
	return k.SendCoins(s, ModuleAccountAddress(moduleName), recipient, amount)
}

func (k *Keeper) SendCoinsFromAccountToModule(s store.KVStore, sender string, moduleName string, amount math.Int) error {
	return k.SendCoins(s, sender, ModuleAccountAddress(moduleName), amount)
}

func (k *Keeper) SendCoinsFromModuleToModule(s store.KVStore, senderModule string, recipientModule string, amount math.Int) error {
	return k.SendCoins(s, ModuleAccountAddress(senderModule), ModuleAccountAddress(recipientModule), amount)
}
