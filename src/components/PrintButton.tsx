"use client";
import { buttonClass } from "./ui";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary", "sm")}>
      Print / PDF
    </button>
  );
}
