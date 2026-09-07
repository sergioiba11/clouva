"use client";

import { useMemo } from "react";
import { FLOW_COUNTRY_CODES, normalizeCountryCode } from "@/lib/flows/flow-region";

type CountrySelectProps = {
  value: string | null | undefined;
  onChange: (countryCode: string) => void;
  label?: string;
  required?: boolean;
  className?: string;
};

export function CountrySelect({
  value,
  onChange,
  label = "País",
  required = false,
  className = "",
}: CountrySelectProps) {
  const options = useMemo(() => {
    let displayNames: Intl.DisplayNames | null = null;
    try {
      displayNames = new Intl.DisplayNames(["es"], { type: "region" });
    } catch {
      displayNames = null;
    }

    return FLOW_COUNTRY_CODES.map((code) => ({
      code,
      name: displayNames?.of(code) || code,
    })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, []);

  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1.5 block text-white/65">{label}</span>
      <select
        value={normalizeCountryCode(value) ?? ""}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/20 bg-[#090811] px-3 py-2.5 text-white outline-none transition focus:border-violet-400/50"
      >
        <option value="">Seleccioná tu país</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
      <span className="mt-1.5 block text-[11px] leading-4 text-white/35">
        CLOUVA usa este país persistente para tu identidad regional de FLOW. No depende de GPS ni IP.
      </span>
    </label>
  );
}
