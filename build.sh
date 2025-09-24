emcc simulator.c analyzer.cpp \
  -O3 -s WASM=1 \
  -s EXPORTED_FUNCTIONS='["_run_simulation","_compute_metrics_from_buffer","_detect_anomalies","_malloc","_free"]' \
  -s EXTRA_EXPORTED_RUNTIME_METHODS='["cwrap","getValue","setValue","HEAPF64","HEAP32","allocate","lengthBytesUTF8","UTF8ToString"]' \
  -o pw_stress_wasm.js