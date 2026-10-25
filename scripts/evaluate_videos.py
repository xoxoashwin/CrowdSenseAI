"""
CrowdSense AI - Repeatable Multi-Video Evaluation Suite
Evaluates counting precision, recall, and accuracy across multiple benchmark videos
with ground-truth entries and exits.
"""

import os
import sys
import time
from typing import Any, Dict, List

# Add workspace root to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.video_processor import VideoProcessor
from backend.counter import OccupancyCounter


BENCHMARK_DATASETS: List[Dict[str, Any]] = [
    {
        "name": "Men In/Out Doorway (Pexels 4077522)",
        "file": "uploads/videos/15ac2d1844c94b71ace5a6a96b29af60.mp4",
        "camera_view": "Front-facing doorway with perspective corridor",
        "gt_entries": 1,
        "gt_exits": 1,
        "line_position": 0.50,
        "point_mode": "bottom_center",
        "entry_direction": "down",
        "conf_threshold": 0.20,
    },
    {
        "name": "Doorway Passage 2",
        "file": "uploads/videos/21f8a45bd7004aeca4e6209039baaf43.mp4",
        "camera_view": "Angled doorway footfall view",
        "gt_entries": 0,
        "gt_exits": 1,
        "line_position": 0.50,
        "point_mode": "bottom_center",
        "entry_direction": "down",
        "conf_threshold": 0.25,
    },
    {
        "name": "Empty Room Negative Control",
        "file": "uploads/videos/de976fbf95bb4ba49fb8ae61cd6ec832.mp4",
        "camera_view": "Static interior doorway with zero pedestrian traffic",
        "gt_entries": 0,
        "gt_exits": 0,
        "line_position": 0.50,
        "point_mode": "center",
        "entry_direction": "down",
        "conf_threshold": 0.25,
    },
]


def run_evaluation() -> Dict[str, Any]:
    print("=" * 80)
    print(" CROWDSENSE AI - MULTI-VIDEO EVALUATION BENCHMARK")
    print("=" * 80)

    results = []
    total_gt_in = 0
    total_gt_out = 0
    total_pred_in = 0
    total_pred_out = 0
    total_tp = 0
    total_fp = 0
    total_fn = 0

    for idx, item in enumerate(BENCHMARK_DATASETS, 1):
        video_path = os.path.abspath(item["file"])
        if not os.path.exists(video_path):
            print(f"[-] Video #{idx}: File not found ({item['file']}), skipping...")
            continue

        print(f"\n[{idx}/{len(BENCHMARK_DATASETS)}] Evaluating: {item['name']}")
        print(f"    Path: {os.path.basename(video_path)}")
        print(f"    Camera View: {item['camera_view']}")
        print(f"    Config: line={item['line_position']}, dir={item['entry_direction']}, mode={item['point_mode']}, conf={item['conf_threshold']}")

        # Isolated test counter for evaluation
        test_counter = OccupancyCounter(capacity=100, auto_restore=False)
        vp = VideoProcessor(
            counter=test_counter,
            line_position=item["line_position"],
            entry_direction=item["entry_direction"],
            conf_threshold=item["conf_threshold"],
            point_mode=item["point_mode"],
            run_id=f"eval_run_{idx}",
        )

        start_t = time.time()
        summary = vp.process_video(video_path)
        duration = time.time() - start_t

        pred_in = summary["entries_detected"]
        pred_out = summary["exits_detected"]
        gt_in = item["gt_entries"]
        gt_out = item["gt_exits"]

        # Calculate True Positives, False Positives, False Negatives
        tp_in = min(pred_in, gt_in)
        fp_in = max(0, pred_in - gt_in)
        fn_in = max(0, gt_in - pred_in)

        tp_out = min(pred_out, gt_out)
        fp_out = max(0, pred_out - gt_out)
        fn_out = max(0, gt_out - pred_out)

        tp = tp_in + tp_out
        fp = fp_in + fp_out
        fn = fn_in + fn_out

        total_gt_in += gt_in
        total_gt_out += gt_out
        total_pred_in += pred_in
        total_pred_out += pred_out
        total_tp += tp
        total_fp += fp
        total_fn += fn

        precision = (tp / (tp + fp)) * 100.0 if (tp + fp) > 0 else 100.0
        recall = (tp / (tp + fn)) * 100.0 if (tp + fn) > 0 else 100.0
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 100.0

        status_str = "EXACT MATCH" if (pred_in == gt_in and pred_out == gt_out) else "MISMATCH"

        res = {
            "name": item["name"],
            "filename": os.path.basename(video_path),
            "camera_view": item["camera_view"],
            "frames": summary["processed_frames"],
            "fps": round(summary["processed_frames"] / max(1e-4, duration), 1),
            "gt_in": gt_in,
            "pred_in": pred_in,
            "gt_out": gt_out,
            "pred_out": pred_out,
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "precision": round(precision, 1),
            "recall": round(recall, 1),
            "f1": round(f1, 1),
            "status": status_str,
        }
        results.append(res)

        print(f"    Result: GT=[+{gt_in} In, -{gt_out} Out] | Predicted=[+{pred_in} In, -{pred_out} Out] -> {status_str}")
        print(f"    Metrics: TP={tp}, FP={fp}, FN={fn} | Precision={precision:.1f}%, Recall={recall:.1f}%")

    # Aggregate evaluation summary
    total_precision = (total_tp / (total_tp + total_fp)) * 100.0 if (total_tp + total_fp) > 0 else 100.0
    total_recall = (total_tp / (total_tp + total_fn)) * 100.0 if (total_tp + total_fn) > 0 else 100.0
    total_f1 = (2 * total_precision * total_recall) / (total_precision + total_recall) if (total_precision + total_recall) > 0 else 100.0

    print("\n" + "=" * 80)
    print(" SUMMARY BENCHMARK TABLE")
    print("=" * 80)
    header = f"{'Video Name':<32} | {'GT':<9} | {'Pred':<9} | {'Precision':<10} | {'Recall':<8} | {'Status'}"
    print(header)
    print("-" * len(header))
    for r in results:
        gt_s = f"+{r['gt_in']}/-{r['gt_out']}"
        pred_s = f"+{r['pred_in']}/-{r['pred_out']}"
        prec_s = f"{r['precision']}%"
        rec_s = f"{r['recall']}%"
        print(f"{r['name'][:32]:<32} | {gt_s:<9} | {pred_s:<9} | {prec_s:<10} | {rec_s:<8} | {r['status']}")

    print("-" * len(header))
    print(f"OVERALL METRICS: Precision = {total_precision:.1f}% | Recall = {total_recall:.1f}% | F1-Score = {total_f1:.1f}%")
    print("=" * 80)

    return {
        "dataset_results": results,
        "total_precision": round(total_precision, 1),
        "total_recall": round(total_recall, 1),
        "total_f1": round(total_f1, 1),
    }


if __name__ == "__main__":
    run_evaluation()
