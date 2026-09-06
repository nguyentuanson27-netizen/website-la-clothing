"use client";

import { useId, useState } from "react";

import { measureSeoLength } from "@/commerce/seo-length-guidance";

type SeoLengthFieldProps = {
  label: string;
  name: string;
  defaultValue: string;
  /** The enforced storage bound. Unchanged by this component and far above the advisory target. */
  maxLength: number;
  /** Where search results usually truncate. Advice only — nothing here blocks or gates on it. */
  recommendedLength: number;
  multiline?: boolean;
  rows?: number;
  className: string;
};

export function SeoLengthField({
  label,
  name,
  defaultValue,
  maxLength,
  recommendedLength,
  multiline = false,
  rows,
  className,
}: SeoLengthFieldProps) {
  // Deliberately uncontrolled. The field keeps the exact submit behaviour it had before this
  // counter existed - React owns none of its value - so nothing about saving changes, and only the
  // advisory readout is state.
  const [measured, setMeasured] = useState(() =>
    measureSeoLength(defaultValue, recommendedLength),
  );
  const guidanceId = useId();
  const { length, overRecommended } = measured;

  const shared = {
    "aria-describedby": guidanceId,
    className,
    defaultValue,
    maxLength,
    name,
    onChange: (event: { target: { value: string } }) =>
      setMeasured(measureSeoLength(event.target.value, recommendedLength)),
  };

  return (
    <div>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-[0.13em]">{label}</span>
        {multiline ? <textarea {...shared} rows={rows} /> : <input {...shared} type="text" />}
      </label>
      {/*
        Advice, announced politely as it changes. Running long is stated as a fact about search
        display and immediately paired with the reassurance that it still saves — the editor is
        told what will happen in results, not warned off finishing their sentence.
      */}
      <p
        aria-live="polite"
        className={`mt-2 text-xs ${overRecommended ? "text-black" : "text-black/55"}`}
        id={guidanceId}
      >
        <span className="font-semibold tabular-nums">
          {length}/{recommendedLength}
        </span>{" "}
        ký tự khuyến nghị
        {overRecommended ? " — dài hơn khuyến nghị, vẫn lưu được." : "."}
      </p>
    </div>
  );
}
