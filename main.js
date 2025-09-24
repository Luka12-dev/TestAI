(() => {
  'use strict';

  // UI
  const clientsEl = document.getElementById('clients');
  const rpsEl = document.getElementById('rps');
  const durationEl = document.getElementById('duration');
  const baseLatencyEl = document.getElementById('baseLatency');
  const jitterEl = document.getElementById('jitter');
  const spikeChanceEl = document.getElementById('spikeChance');

  const runBtn = document.getElementById('runBtn');
  const exportBtn = document.getElementById('exportBtn');
  const statusEl = document.getElementById('status');
  const metricsEl = document.getElementById('metrics');
  const canvas = document.getElementById('latencyChart');
  const ctx = canvas.getContext('2d');

  // WASM hooks
  let ModuleGlobal = null;
  let wasmReady = false;
  let wasmRunSim = null;
  let wasmComputeMetrics = null;

  // Initialize WASM if present (supports createPWStressModule or global Module)
  async function initWasm() {
    try {
      if (typeof createPWStressModule === 'function') {
        const Module = await createPWStressModule();
        setupModule(Module);
        return;
      }
    } catch (e) {
      console.warn('createPWStressModule failed:', e);
    }
    try {
      if (window.Module && typeof Module.cwrap === 'function') {
        setupModule(Module);
        return;
      }
    } catch (e) {
      console.warn('Global Module not available:', e);
    }
    console.log('WASM not found - using pure JS simulation');
  }

  function setupModule(Module) {
    ModuleGlobal = Module;
    try {
      wasmRunSim = Module.cwrap('run_simulation', null, ['number','number','number','number','number','number']);
      wasmComputeMetrics = Module.cwrap('compute_metrics_from_buffer', null, ['number','number','number']);
      wasmReady = true;
      console.log('WASM functions wrapped');
    } catch (e) {
      console.warn('Failed to cwrap wasm functions', e);
    }
  }

  function jsRunSimulation(clients, rps, duration, baseLatency, jitter, spikeChance) {
    // approximate total samples = clients * rps * duration
    const totalExpected = Math.max(1, Math.floor(clients * rps * duration));
    const latencies = new Float64Array(totalExpected);
    let idx = 0;
    const rng = () => Math.random();

    for (let t = 0; t < duration; t++) {
      const perSecond = Math.round(clients * rps);
      for (let i = 0; i < perSecond && idx < totalExpected; i++, idx++) {
        // base + jitter * U(-1,1) + occasional spike
        let l = baseLatency + (rng() * 2 - 1) * jitter;
        // spike?
        if (rng() < (spikeChance / 100)) l += Math.random() * jitter * 10 + jitter * 2;
        // ensure positive
        if (l < 0) l = 1;
        latencies[idx] = l;
      }
    }
    return latencies.subarray(0, idx);
  }

  function computeMetrics(latArr) {
    if (!latArr || latArr.length === 0) return null;
    const arr = Array.from(latArr).sort((a,b)=>a-b);
    const sum = arr.reduce((s,v)=>s+v,0);
    const avg = sum / arr.length;
    const p = (q) => {
      const i = Math.floor((arr.length - 1) * q);
      return arr[i];
    };
    const p50 = p(0.5);
    const p90 = p(0.9);
    const p95 = p(0.95);
    const p99 = p(0.99);
    const throughput = arr.length / (Number(durationEl.value) || 1);
    return {count:arr.length, avg, p50, p90, p95, p99, throughput};
  }

  function drawLatencyChart(latArr) {
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.clearRect(0,0,w,h);
    if (!latArr || latArr.length === 0) return;
    const step = Math.max(1, Math.floor(latArr.length / 1000)); // downsample
    const sampled = [];
    for (let i = 0; i < latArr.length; i += step) sampled.push(latArr[i]);

    const max = Math.max(...sampled);
    const min = Math.min(...sampled);
    const pad = 10 * devicePixelRatio;
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.strokeStyle = '#7dd3fc';
    ctx.beginPath();
    sampled.forEach((v,i) => {
      const x = pad + (i / (sampled.length - 1)) * (w - pad*2);
      const y = pad + (1 - (v - min) / (max - min || 1)) * (h - pad*2);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${12 * devicePixelRatio}px Inter, Arial`;
    ctx.fillText(`samples: ${latArr.length}`, pad, h - pad/2);
    ctx.fillText(`min ${min.toFixed(1)} ms`, pad + 140, h - pad/2);
    ctx.fillText(`max ${max.toFixed(1)} ms`, pad + 260, h - pad/2);
  }

  function exportCSV(latArr) {
    if (!latArr || latArr.length === 0) return;
    let csv = 'index,latency_ms\n';
    for (let i = 0; i < latArr.length; i++) csv += `${i+1},${latArr[i].toFixed(6)}\n`;
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stresstest_latencies.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function runOrSimulate() {
    runBtn.disabled = true;
    statusEl.textContent = 'Preparing...';
    const clients = Number(clientsEl.value) || 1;
    const rps = Number(rpsEl.value) || 0.1;
    const duration = Number(durationEl.value) || 5;
    const baseLatency = Number(baseLatencyEl.value) || 50;
    const jitter = Number(jitterEl.value) || 10;
    const spikeChance = Number(spikeChanceEl.value) || 0;

    const maxSamples = Math.max(1000, Math.ceil(clients * rps * duration * 1.2));

    try {
      let latencies;
      if (wasmReady && wasmRunSim && ModuleGlobal) {
        statusEl.textContent = 'Running simulation (WASM)...';
        const bytes = maxSamples * 8;
        const ptr = ModuleGlobal._malloc(bytes);
        const outCountPtr = ModuleGlobal._malloc(4);

        wasmRunSim(clients, rps, duration, ptr, maxSamples, outCountPtr);

        const count = ModuleGlobal.HEAP32[outCountPtr / 4];
        const latBuf = new Float64Array(ModuleGlobal.HEAPF64.buffer, ptr, count);

        latencies = new Float64Array(count);
        latencies.set(latBuf.subarray(0, count));

        ModuleGlobal._free(ptr);
        ModuleGlobal._free(outCountPtr);
      } else {
        statusEl.textContent = 'Running simulation (JS)...';
        latencies = jsRunSimulation(clients, rps, duration, baseLatency, jitter, spikeChance);
      }

      statusEl.textContent = 'Computing metrics...';
      let metrics;
      if (wasmReady && wasmComputeMetrics && ModuleGlobal) {
        const metricsPtr = ModuleGlobal._malloc(4 * 8);
        const bytes = latencies.length * 8;
        const ptr2 = ModuleGlobal._malloc(bytes);
        ModuleGlobal.HEAPF64.set(latencies, ptr2 / 8);
        wasmComputeMetrics(ptr2, latencies.length, metricsPtr);
        const m = new Float64Array(ModuleGlobal.HEAPF64.buffer, metricsPtr, 4);
        metrics = { avg: m[0], p50: m[1], p95: m[2], throughput: m[3], count: latencies.length };
        ModuleGlobal._free(ptr2);
        ModuleGlobal._free(metricsPtr);
      } else {
        const m = computeMetrics(latencies);
        metrics = { avg: m.avg, p50: m.p50, p95: m.p95, p99: m.p99, throughput: m.throughput, count: m.count };
      }

      // render metrics & chart
      renderMetrics(metrics);
      drawLatencyChart(latencies);

      // store last results on window for export
      window.__stresstest_last = {latencies, metrics};

      statusEl.textContent = 'Done';
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
    } finally {
      runBtn.disabled = false;
    }
  }

  function renderMetrics(m) {
    metricsEl.innerHTML = '';
    const push = (title, val, unit='') => {
      const el = document.createElement('div');
      el.className = 'metric';
      el.innerHTML = `<h3>${title}</h3><p>${val}${unit}</p>`;
      metricsEl.appendChild(el);
    };
    push('Samples', m.count);
    push('Avg latency', m.avg ? m.avg.toFixed(2) : '-', ' ms');
    push('P50', m.p50 ? m.p50.toFixed(2) : '-', ' ms');
    push('P95', m.p95 ? m.p95.toFixed(2) : '-', ' ms');
    if (m.p99 !== undefined) push('P99', m.p99.toFixed(2), ' ms');
    push('Throughput', m.throughput ? m.throughput.toFixed(2) : '-', ' req/s');
  }

  runBtn.addEventListener('click', runOrSimulate);
  exportBtn.addEventListener('click', () => {
    if (window.__stresstest_last && window.__stresstest_last.latencies) exportCSV(window.__stresstest_last.latencies);
  });

  initWasm();
})();