package types_test

import (
	"testing"

	"cosmossdk.io/math"
	"github.com/sovra/chain/x/issuance/types"
)

func TestCanonicalRecurrenceAndTotals(t *testing.T) {
	// 1. Verify dynamic recurrence matches published array identically
	generated := types.GenerateCanonicalSeederSchedule()
	for y := 0; y < 25; y++ {
		if generated[y] != types.CanonicalAnnualSeederSchedule[y] {
			t.Fatalf("Year %d mismatch: generated %d != published %d", y+1, generated[y], types.CanonicalAnnualSeederSchedule[y])
		}
	}

	// 2. Verify exact lifetime pool totals
	var sumS, sumV, sumC, sumE math.Int = math.ZeroInt(), math.ZeroInt(), math.ZeroInt(), math.ZeroInt()

	for y := 1; y <= 25; y++ {
		e, v, c, s := types.GetAnnualPoolAllocations(y)

		// Strict per-year integer identities
		if !v.Equal(s.MulRaw(2)) {
			t.Fatalf("Year %d: V (%s) != 2*S (%s)", y, v, s.MulRaw(2))
		}
		if !c.Equal(s.MulRaw(4)) {
			t.Fatalf("Year %d: C (%s) != 4*S (%s)", y, c, s.MulRaw(4))
		}
		if !e.Equal(s.MulRaw(7)) {
			t.Fatalf("Year %d: E (%s) != 7*S (%s)", y, e, s.MulRaw(7))
		}
		if !e.Equal(v.Add(c).Add(s)) {
			t.Fatalf("Year %d: E (%s) != V+C+S", y, e)
		}

		sumS = sumS.Add(s)
		sumV = sumV.Add(v)
		sumC = sumC.Add(c)
		sumE = sumE.Add(e)
	}

	expectedS := math.NewInt(10_000_000_000_000)
	expectedV := math.NewInt(20_000_000_000_000)
	expectedC := math.NewInt(40_000_000_000_000)
	expectedE := math.NewInt(70_000_000_000_000)

	if !sumS.Equal(expectedS) {
		t.Fatalf("Seeder sum %s != %s", sumS, expectedS)
	}
	if !sumV.Equal(expectedV) {
		t.Fatalf("Validator sum %s != %s", sumV, expectedV)
	}
	if !sumC.Equal(expectedC) {
		t.Fatalf("Community sum %s != %s", sumC, expectedC)
	}
	if !sumE.Equal(expectedE) {
		t.Fatalf("Total emission sum %s != %s", sumE, expectedE)
	}

	// 3. Year 25 residual properties
	s24 := types.CanonicalAnnualSeederSchedule[23]
	s25 := types.CanonicalAnnualSeederSchedule[24]

	if s25 <= 0 {
		t.Fatalf("Year 25 residual %d is not strictly positive", s25)
	}
	if s25 >= s24 {
		t.Fatalf("Year 25 residual %d is not less than Year 24 (%d)", s25, s24)
	}
	if s25 != 186935111695 {
		t.Fatalf("Year 25 residual %d != 186935111695", s25)
	}
}

func TestDailyEpochAllocation241Ratio(t *testing.T) {
	// Verify that the 2:4:1 ratio holds on EVERY single daily epoch (1 to 9125)
	var cumulativeS, cumulativeV, cumulativeC math.Int = math.ZeroInt(), math.ZeroInt(), math.ZeroInt()

	for y := 1; y <= 25; y++ {
		_, annualV, annualC, annualS := types.GetAnnualPoolAllocations(y)

		var yearS, yearV, yearC math.Int = math.ZeroInt(), math.ZeroInt(), math.ZeroInt()

		for d := 1; d <= 365; d++ {
			epoch := uint64((y-1)*365 + d)
			vDay, cDay, sDay := types.ComputeEpochAllowance(epoch)

			// Ratio 2:4:1 must hold exactly on this specific daily epoch
			if !vDay.Equal(sDay.MulRaw(2)) {
				t.Fatalf("Epoch %d (Y%d D%d): V (%s) != 2*S (%s)", epoch, y, d, vDay, sDay.MulRaw(2))
			}
			if !cDay.Equal(sDay.MulRaw(4)) {
				t.Fatalf("Epoch %d (Y%d D%d): C (%s) != 4*S (%s)", epoch, y, d, cDay, sDay.MulRaw(4))
			}

			yearS = yearS.Add(sDay)
			yearV = yearV.Add(vDay)
			yearC = yearC.Add(cDay)
		}

		// Sum of all 365 daily allocations in year y must match annual pool budget exactly
		if !yearS.Equal(annualS) {
			t.Fatalf("Year %d daily Seeder sum %s != annual %s", y, yearS, annualS)
		}
		if !yearV.Equal(annualV) {
			t.Fatalf("Year %d daily Validator sum %s != annual %s", y, yearV, annualV)
		}
		if !yearC.Equal(annualC) {
			t.Fatalf("Year %d daily Community sum %s != annual %s", y, yearC, annualC)
		}

		cumulativeS = cumulativeS.Add(yearS)
		cumulativeV = cumulativeV.Add(yearV)
		cumulativeC = cumulativeC.Add(yearC)
	}

	if !cumulativeS.Equal(types.SeederCap) {
		t.Fatalf("Cumulative Seeder %s != %s", cumulativeS, types.SeederCap)
	}
	if !cumulativeV.Equal(types.ValidatorCap) {
		t.Fatalf("Cumulative Validator %s != %s", cumulativeV, types.ValidatorCap)
	}
	if !cumulativeC.Equal(types.CommunityCap) {
		t.Fatalf("Cumulative Community %s != %s", cumulativeC, types.CommunityCap)
	}
}

func TestResolveEpochSignedArithmetic(t *testing.T) {
	var genesisTime int64 = 1_700_000_000

	// 1. Pre-genesis timestamp (e.g. genesis - 100 seconds)
	epoch, phase := types.ResolveEpoch(genesisTime-100, genesisTime)
	if phase != types.PhasePreGenesis || epoch != 0 {
		t.Fatalf("Pre-genesis failed: got epoch %d, phase %v", epoch, phase)
	}

	// 2. Exactly at genesis (t = genesis)
	epoch, phase = types.ResolveEpoch(genesisTime, genesisTime)
	if phase != types.PhaseActive || epoch != 1 {
		t.Fatalf("Genesis second failed: got epoch %d, phase %v", epoch, phase)
	}

	// 3. Last second of Epoch 1 (t = genesis + 86399)
	epoch, phase = types.ResolveEpoch(genesisTime+86399, genesisTime)
	if phase != types.PhaseActive || epoch != 1 {
		t.Fatalf("Last second of Epoch 1 failed: got epoch %d, phase %v", epoch, phase)
	}

	// 4. First second of Epoch 2 (t = genesis + 86400)
	epoch, phase = types.ResolveEpoch(genesisTime+86400, genesisTime)
	if phase != types.PhaseActive || epoch != 2 {
		t.Fatalf("Epoch 2 start failed: got epoch %d, phase %v", epoch, phase)
	}

	// 5. Last second of active policy (Epoch 9125: t = genesis + 788,400,000 - 1)
	terminalSec := genesisTime + 788_400_000
	epoch, phase = types.ResolveEpoch(terminalSec-1, genesisTime)
	if phase != types.PhaseActive || epoch != 9125 {
		t.Fatalf("Final active second failed: got epoch %d, phase %v", epoch, phase)
	}

	// 6. Exact terminal timestamp (t = genesis + 788,400,000)
	epoch, phase = types.ResolveEpoch(terminalSec, genesisTime)
	if phase != types.PhaseTerminal || epoch != 9126 {
		t.Fatalf("Terminal boundary failed: got epoch %d, phase %v", epoch, phase)
	}

	// 7. Far future terminal timestamp (100 years later)
	epoch, phase = types.ResolveEpoch(terminalSec+365*86400*100, genesisTime)
	if phase != types.PhaseTerminal {
		t.Fatalf("Far future failed: got phase %v", phase)
	}
}
