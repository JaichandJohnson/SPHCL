import React from "react";
import { NOT_TESTED_REASONS } from "@/lib/notTestedReasons";

export default function NotTestedReasonEditor({ value, onChange }) {
  const reason = String(value || "");
  const isPreset = NOT_TESTED_REASONS.includes(reason);
  return (
    <div className="space-y-1">
      <select
        aria-label="Reason for Not Tested"
        className="w-full rounded border bg-white p-2"
        value={isPreset ? reason : reason ? "__custom__" : ""}
        onChange={(event) => {
          const selected = event.target.value;
          onChange(selected === "__custom__" || selected === "" ? "" : selected);
        }}
      >
        <option value="">Select reason (required)</option>
        {NOT_TESTED_REASONS.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
        <option value="__custom__">Enter another reason…</option>
      </select>
      {!isPreset && (
        <input
          aria-label="Other reason for Not Tested"
          className="w-full rounded border p-2"
          placeholder="Or enter the reason directly (required)"
          value={reason}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
