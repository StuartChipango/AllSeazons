Reads receipts on the phone (no internet AI needed). Apache 2.0 licence.

- tesseract.min.js, worker.min.js: tesseract.js 5.1.1
- tesseract-core-*.wasm.js: tesseract.js-core 5.1.1 (LSTM engine, with and without SIMD)
- eng.traineddata.gz: English, 4.0.0_best_int (@tesseract.js-data/eng 1.0.0)

Used by assets/js/staff/receipt-reader.js. Loaded only when someone reads a receipt.
