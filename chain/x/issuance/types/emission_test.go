package types_test

import (
	"testing"

	"cosmossdk.io/math"
	"github.com/sovra/chain/x/issuance/types"
)

func TestBitcoinInspiredHalvingScheduleAndTotals(t *testing.T) {
	// 1. Verify exact 50% bit-shift halving across all 32 four-year eras (128 years)
	for era := 0; era < types.MaxHalvingEras-1; era++ {
		cur := types.ComputeHalvingBaseDaily(era)
		nxt := types.ComputeHalvingBaseDaily(era + 1)
		if cur <= 0 {
			t.Fatalf("Era %d daily base %d is not positive", era, cur)
		}
		if nxt != (cur >> 1) {
			t.Fatalf("Era %d -> %d halving mismatch: %d != %d >> 1", era, era+1, nxt, cur)
		}
	}

	// Era 31 emits minimum 1 uSOV base atom; Era 32 drops to 0 (Bitcoin terminal convergence)
	if lastBase := types.ComputeHalvingBaseDaily(31); lastBase != 1 {
		t.Fatalf("Era 31 final base expected 1 uSOV, got %d", lastBase)
	}
	if termBase := types.ComputeHalvingBaseDaily(32); termBase != 0 {
		t.Fatalf("Era 32 terminal base expected 0 uSOV, got %d", termBase)
	}

	// 2. Verify lifetime pool totals, Seeder-dominant 2:1:4 weighting, and 20-year front-loading (~96.875%)
	var sumC, sumV, sumS, sumE math.Int = math.ZeroInt(), math.ZeroInt(), math.ZeroInt(), math.ZeroInt()
	var first4YearsE, first20YearsE math.Int = math.ZeroInt(), math.ZeroInt()

	for era := 0; era < types.MaxHalvingEras; era++ {
		e, v, c, s := types.GetHalvingEraAllocations(era)

		// Exact 2:1:4 ratio (Validator : Community : Seeder)
		if !v.Equal(c.MulRaw(2)) {
			t.Fatalf("Era %d: V (%s) != 2*C (%s)", era, v, c.MulRaw(2))
		}
		if !s.Equal(c.MulRaw(4)) {
			t.Fatalf("Era %d: S (%s) != 4*C (%s)", era, s, c.MulRaw(4))
		}
		if !e.Equal(c.MulRaw(7)) || !e.Equal(v.Add(c).Add(s)) {
			t.Fatalf("Era %d: E (%s) != 7*C / V+C+S", era, e)
		}

		if era == 0 {
			first4YearsE = e
		}
		if era < 5 {
			first20YearsE = first20YearsE.Add(e)
		}

		sumC = sumC.Add(c)
		sumV = sumV.Add(v)
		sumS = sumS.Add(s)
		sumE = sumE.Add(e)
	}

	// Era 0 (Years 1-4) ~50% of 70M minable supply; Eras 0..4 (Years 1-20) ~96.875%
	if first4YearsE.LT(math.NewInt(34_999_000_000_000)) || first4YearsE.GT(math.NewInt(35_000_000_000_000)) {
		t.Fatalf("First 4 years emission %s outside expected ~35M SOV (50%%)", first4YearsE)
	}
	if first20YearsE.LT(math.NewInt(67_812_000_000_000)) || first20YearsE.GT(math.NewInt(67_813_000_000_000)) {
		t.Fatalf("First 20 years emission %s outside expected ~67.8125M SOV (96.875%%)", first20YearsE)
	}

	// Bitcoin integer-shift convergence strictly <= PoolCaps (never over-mints 100M hard cap)
	// with sub-millitoken dust < 0.0002 SOV across 128 years
	if sumC.GT(types.CommunityCap) || sumC.LT(types.CommunityCap.SubRaw(100_000)) {
		t.Fatalf("Cumulative Community %s out of expected [Cap-100k, Cap]", sumC)
	}
	if sumV.GT(types.ValidatorCap) || !sumV.Equal(sumC.MulRaw(2)) {
		t.Fatalf("Cumulative Validator %s inconsistent with 2*C / Cap", sumV)
	}
	if sumS.GT(types.SeederCap) || !sumS.Equal(sumC.MulRaw(4)) {
		t.Fatalf("Cumulative Seeder %s inconsistent with 4*C / Cap", sumS)
	}
	expectedMinableCap := types.CommunityCap.Add(types.ValidatorCap).Add(types.SeederCap)
	if !expectedMinableCap.Equal(math.NewInt(70_000_000_000_000)) {
		t.Fatalf("Minable pool caps sum %s != 70M SOV", expectedMinableCap)
	}
	if sumE.GT(expectedMinableCap) || types.GenesisCap.Add(sumE).GT(types.GlobalLifetimeCap) {
		t.Fatalf("Lifetime emission %s breaches 100M SOV hard cap", sumE)
	}
}

func TestDailyEpochAllocationAndHalvingBoundaries(t *testing.T) {
	// Verify era transition boundaries and 2:1:4 ratio across sampled daily epochs (1..46720)
	checkEpoch := func(epoch uint64, expectedEra int) (math.Int, math.Int, math.Int) {
		if gotEra := types.HalvingEraForEpoch(epoch); gotEra != expectedEra {
			t.Fatalf("Epoch %d: expected era %d, got %d", epoch, expectedEra, gotEra)
		}
		vDay, cDay, sDay := types.ComputeEpochAllowance(epoch)
		if !vDay.IsPositive() || !vDay.Equal(cDay.MulRaw(2)) || !sDay.Equal(cDay.MulRaw(4)) {
			t.Fatalf("Epoch %d: broken 2:1:4 ratio (V=%s C=%s S=%s)", epoch, vDay, cDay, sDay)
		}
		return vDay, cDay, sDay
	}

	_, c1, s1 := checkEpoch(1, 0)
	_, c1460, _ := checkEpoch(1460, 0)
	_, c1461, s1461 := checkEpoch(1461, 1)
	if !c1.Equal(c1460) {
		t.Fatalf("Daily allocation drifted inside Era 0")
	}
	if !c1461.Equal(c1.QuoRaw(2)) || !s1461.Equal(s1.QuoRaw(2)) {
		t.Fatalf("First halving boundary (1460->1461) did not halve cleanly")
	}

	checkEpoch(7300, 4)  // End of Year 20
	checkEpoch(7301, 5)  // Start of Era 5 (Year 21)
	vLast, cLast, sLast := checkEpoch(46720, 31)
	if !cLast.Equal(math.NewInt(1)) || !vLast.Equal(math.NewInt(2)) || !sLast.Equal(math.NewInt(4)) {
		t.Fatalf("Era 31 final day expected V=2 C=1 S=4 uSOV, got V=%s C=%s S=%s", vLast, cLast, sLast)
	}

	// Out of bounds / terminal epoch returns zero
	vZero, cZero, sZero := types.ComputeEpochAllowance(46721)
	if !vZero.IsZero() || !cZero.IsZero() || !sZero.IsZero() {
		t.Fatalf("Terminal epoch 46721 expected zero allocations")
	}

	// Verify 128 annual lookups reconcile to exact 32-era cumulative sum
	var yearTotalE math.Int = math.ZeroInt()
	for y := 1; y <= 128; y++ {
		e, v, c, s := types.GetAnnualPoolAllocations(y)
		if !v.Equal(c.MulRaw(2)) || !s.Equal(c.MulRaw(4)) || !e.Equal(v.Add(c).Add(s)) {
			t.Fatalf("Year %d annual 2:1:4 invariant broken", y)
		}
		yearTotalE = yearTotalE.Add(e)
	}
	if yearTotalE.GT(math.NewInt(70_000_000_000_000)) {
		t.Fatalf("128-year annual sum %s exceeds 70M SOV", yearTotalE)
	}
}

func TestResolveEpochSignedArithmetic(t *testing.T) {
	var genesisTime int64 = 1_700_000_000

	// 1. Pre-genesis timestamp
	epoch, phase := types.ResolveEpoch(genesisTime-100, genesisTime)
	if phase != types.PhasePreGenesis || epoch != 0 {
		t.Fatalf("Pre-genesis failed: got epoch %d, phase %v", epoch, phase)
	}

	// 2. Exactly at genesis (t = genesis)
	epoch, phase = types.ResolveEpoch(genesisTime, genesisTime)
	if phase != types.PhaseActive || epoch != 1 {
		t.Fatalf("Genesis second failed: got epoch %d, phase %v", epoch, phase)
	}

	// 3. First halving boundary (Epoch 1461 starts at day 1460 * 86400)
	epoch, phase = types.ResolveEpoch(genesisTime+1460*86400, genesisTime)
	if phase != types.PhaseActive || epoch != 1461 {
		t.Fatalf("Halving Era 1 start failed: got epoch %d, phase %v", epoch, phase)
	}

	// 4. Last second of 128-year policy (Epoch 46720: t = genesis + 46720 * 86400 - 1)
	terminalSec := genesisTime + int64(types.TotalPolicyEpochs)*int64(types.EpochDurationSeconds)
	epoch, phase = types.ResolveEpoch(terminalSec-1, genesisTime)
	if phase != types.PhaseActive || epoch != 46720 {
		t.Fatalf("Final active second failed: got epoch %d, phase %v", epoch, phase)
	}

	// 5. Exact terminal timestamp (Epoch 46721)
	epoch, phase = types.ResolveEpoch(terminalSec, genesisTime)
	if phase != types.PhaseTerminal || epoch != 46721 {
		t.Fatalf("Terminal boundary failed: got epoch %d, phase %v", epoch, phase)
	}

	// 6. Far future terminal timestamp
	epoch, phase = types.ResolveEpoch(terminalSec+365*86400*100, genesisTime)
	if phase != types.PhaseTerminal {
		t.Fatalf("Far future failed: got phase %v", phase)
	}
}
