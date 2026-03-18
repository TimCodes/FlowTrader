import type { FeatureVector, OrderFlowSignal, CatalystSignal } from "@trading/types";
import { STREAMS } from "@trading/types";

/**
 * ML Agents Service
 *
 * Runs two agents locally on the RTX 4090:
 *
 * 1. Order Flow Agent (LSTM/Transformer, ~1-2GB VRAM)
 *    - Input: FeatureVector from features:{symbol} stream
 *    - Output: OrderFlowSignal (signal type + confidence)
 *    - Inference target: <50ms
 *    - Model format: ONNX (via onnxruntime-node with CUDA)
 *
 * 2. Catalyst Agent (fine-tuned 7B LLM, ~4-6GB VRAM)
 *    - Input: CatalystEvent from news:{symbol} stream
 *    - Output: CatalystSignal (category, magnitude, sentiment)
 *    - Inference target: <500ms
 *    - Model: Mistral 7B or Llama 3 8B, 4-bit quantized
 *    - Served via: vLLM or llama.cpp HTTP server
 *
 * Both agents publish signals to Redis for the orchestrator.
 *
 * Config:
 *   REDIS_URL
 *   ORDER_FLOW_MODEL_PATH — path to ONNX model
 *   CATALYST_LLM_MODEL_PATH — path to quantized LLM
 */

async function main() {
  console.log("🚀 ML Agents starting...");
  console.log(`   Order Flow Model: ${process.env.ORDER_FLOW_MODEL_PATH}`);
  console.log(`   Catalyst LLM: ${process.env.CATALYST_LLM_MODEL_PATH}`);
  console.log(`   Redis: ${process.env.REDIS_URL}`);

  // TODO: Implement (Phase 3 — after data collection + training)
  //
  // Order Flow Agent:
  // 1. Load ONNX model with onnxruntime-node (CUDA execution provider)
  // 2. Subscribe to features:{symbol} Redis Stream
  // 3. On each FeatureVector:
  //    a. Normalize features to model input shape
  //    b. Run inference
  //    c. Map output to SignalType + confidence
  //    d. Publish OrderFlowSignal to signal:orderflow:{symbol}
  //
  // Catalyst Agent:
  // 1. Start llama.cpp server as subprocess (or connect to vLLM)
  // 2. Subscribe to news:{symbol} Redis Stream
  // 3. On each CatalystEvent:
  //    a. Format prompt with headline + context
  //    b. Call LLM for structured analysis
  //    c. Parse response into CatalystSignal
  //    d. Publish to signal:catalyst:{symbol}

  console.log("⏳ Waiting for model training (Phase 3)...");
}

main().catch(console.error);
