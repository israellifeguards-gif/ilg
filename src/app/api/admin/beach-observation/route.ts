import { NextResponse } from 'next/server';
import { submitBeachObservation } from '@/lib/api/beachCalibration';
import { BEACHES } from '@/lib/beaches';

// Submit a real-world observation to update the beach height_factor via EMA.
//
// Usage:
//   GET /api/admin/beach-observation?beach=tlv&observed=1.5&model=1.2
//
//   beach    — beach ID (from BEACHES list)
//   observed — face height you actually saw on the water (meters)
//   model    — raw pre-calibration model output (get from /api/admin/debug-surf
//              → waves.effectiveWaveHeightResult)
//
// Response:
//   { ok, beach, oldFactor, newFactor, ratio, observationCount,
//     nextForecast: "model × newFactor = estimated displayed height" }
//
// The EMA (α=0.25) means a single report moves the factor ~25% toward the
// observed ratio. After ~8 consistent observations the factor fully converges.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const beachId   = searchParams.get('beach');
  const obsParam  = searchParams.get('observed');
  const modParam  = searchParams.get('model');

  if (!beachId) {
    return NextResponse.json({ error: 'missing ?beach=' }, { status: 400 });
  }

  if (!BEACHES.find(b => b.id === beachId)) {
    return NextResponse.json({ error: `unknown beach: ${beachId}` }, { status: 404 });
  }

  const observed = obsParam !== null ? parseFloat(obsParam) : NaN;
  const model    = modParam !== null ? parseFloat(modParam) : NaN;

  if (isNaN(observed) || observed <= 0 || observed > 15) {
    return NextResponse.json({ error: `observed=${observed} must be in (0, 15] m` }, { status: 400 });
  }
  if (isNaN(model) || model <= 0 || model > 15) {
    return NextResponse.json({ error: `model=${model} must be in (0, 15] m` }, { status: 400 });
  }

  try {
    const result = await submitBeachObservation(beachId, observed, model);
    return NextResponse.json({
      ok:               true,
      beach:            beachId,
      observed,
      model,
      oldFactor:        result.oldFactor,
      newFactor:        result.newFactor,
      ratio:            result.ratio,
      observationCount: result.observationCount,
      // Show what the NEXT forecast will display for the same model output
      nextForecast:     `${model} × ${result.newFactor} = ${+(model * result.newFactor).toFixed(2)} m`,
    });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('GARBAGE_REPORT')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
