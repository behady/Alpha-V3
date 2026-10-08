"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { serviceDisplayName, serviceMatchesName } from "@/lib/serviceName";
import { Search, ChevronDown, Check } from "lucide-react";
import { DENTAL_CATEGORIES, DentalIcon, categoryLabel, iconForService, suggestCategory } from "@/lib/dentalIcons";
import { resolveListPrice } from "@/lib/discountMath";

export interface ComboboxService {
  id: string | number;
  name: string;
  nameAr?: string | null;
  price?: number;
  [key: string]: any;
}

interface ServiceComboboxProps {
  services: ComboboxService[];
  value: string;
  onChange: (value: string, service?: ComboboxService) => void;
  valueKey?: "id" | "name";
  placeholder?: string;
  disabled?: boolean;
  allowFreeText?: boolean;
  language?: string;
  className?: string;
  dropdownClassName?: string;
  /**
   * The list being charged from, so each row shows what THIS list costs.
   *
   * Without it every row showed `service.price`, the clinic's own rate, whatever list was
   * selected above it. On an insurer that was worse than a cosmetic slip: the receptionist picked
   * the AXA list, read "Orthodontic Consultation — EGP 300" off the menu, and had no way to know
   * the case would actually be charged at AXA's 200. The number she is choosing from has to be
   * the number she is choosing.
   */
  priceListId?: string | null;
}

export default function ServiceCombobox({
  services,
  value,
  onChange,
  priceListId = null,
  valueKey = "id",
  placeholder,
  disabled = false,
  allowFreeText = false,
  language: languageProp,
  className = "",
  dropdownClassName = "",
}: ServiceComboboxProps) {
  const { language: appLanguage } = useLanguage();
  const language = languageProp ?? appLanguage;
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Derive the display text from the selected value
  // By name, either name finds the row: Arabic users save the Arabic one.
  const selectedService = useMemo(
    () => services.find((s) => (valueKey === "name" ? serviceMatchesName(s, value) : String(s[valueKey]) === String(value))),
    [services, value, valueKey]
  );
  const isArUi = language === "ar";
  const label = (s: ComboboxService) => serviceDisplayName(s, isArUi);

  /**
   * What the box shows while the list is shut: the picked service, or the typed name.
   *
   * Derived rather than copied into `search` by an effect. The effect version re-synced `search`
   * from `value` whenever the list closed, which is how a typed name was wiped out: a click
   * elsewhere shut the list before blur had committed the text. `search` is now only the text
   * being typed while the list is open, and it starts from this whenever the list opens.
   */
  const closedText = selectedService ? label(selectedService) : allowFreeText ? value || "" : "";
  const open = () => {
    if (!isOpen) setSearch(closedText);
    setIsOpen(true);
  };

  // Handle outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter and sort services
  const filteredAndSortedServices = useMemo(() => {
    let filtered = services;
    if (search.trim() && isOpen) {
      const lowerSearch = search.toLowerCase();
      filtered = services.filter((s) => s.name.toLowerCase().includes(lowerSearch) || String(s.nameAr || "").toLowerCase().includes(lowerSearch));
    }

    const isArabic = (str: string) => /[\u0600-\u06FF]/.test(str);

    return [...filtered].sort((a, b) => {
      const aIsAr = isArabic(a.name);
      const bIsAr = isArabic(b.name);

      if (aIsAr && !bIsAr) return -1;
      if (!aIsAr && bIsAr) return 1;

      return a.name.localeCompare(b.name, aIsAr ? "ar" : "en");
    });
  }, [services, search, isOpen]);

  // The same list, arranged under its category headings \u2014 the order every other
  // part of the system (the price list, the Android app) shows them in.
  const groupedServices = useMemo(() => {
    const byCat = new Map<string, ComboboxService[]>();
    for (const s of filteredAndSortedServices) {
      const key = (s.category as string) || suggestCategory(s.name);
      byCat.set(key, [...(byCat.get(key) || []), s]);
    }
    return DENTAL_CATEGORIES.filter((c) => byCat.has(c.key)).map((c) => ({
      category: c,
      items: byCat.get(c.key)!,
    }));
  }, [filteredAndSortedServices]);

  const handleSelect = (service: ComboboxService) => {
    onChange(String(service[valueKey]), service);
    setSearch(service.name);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredAndSortedServices.length > 0) {
        handleSelect(filteredAndSortedServices[0]);
      } else if (allowFreeText && search.trim()) {
        onChange(search.trim());
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      open();
    }
  };

  // No commit on blur. Free text already reaches the parent on every keystroke, and the delayed
  // blur commit read this render's values: typing "fil" and then clicking "Filling" in the list
  // fired it after the pick, and put "fil" back over the service just chosen.

  return (
    <div className={`relative ${className}`} ref={containerRef} dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={isOpen ? search : closedText}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
            if (allowFreeText) {
              // Free text is the value, every keystroke. Committing it only on blur lost it: a
              // click on the price box closes the list on mousedown, before blur runs, so blur saw
              // the list shut and committed nothing, and the box went back to the old value.
              onChange(e.target.value);
            } else if (e.target.value === "") {
              // If they clear the input, clear the value
              onChange("");
            }
          }}
          onFocus={() => {
            if (!disabled) {
              open();
              if (selectedService) {
                 // Select all text on focus to make replacing easy
                 setTimeout(() => inputRef.current?.select(), 0);
              }
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (language === "ar" ? "ابحث عن خدمة..." : "Search services...")}
          className={`w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm font-bold text-ink outline-none transition-all focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-70 ${
            language === "ar" ? "pr-10 pl-8" : "pl-10 pr-8"
          }`}
        />
        <Search
          size={16}
          className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${
            language === "ar" ? "right-3" : "left-3"
          }`}
        />
        <ChevronDown
          size={16}
          className={`absolute top-1/2 -translate-y-1/2 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          } ${language === "ar" ? "left-3" : "right-3"} cursor-pointer`}
          onClick={() => {
             if (!disabled) {
                 if (isOpen) setIsOpen(false);
                 else open();
                 inputRef.current?.focus();
             }
          }}
        />
      </div>

      {isOpen && !disabled && (
        <div
          className={`absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-xl custom-scrollbar ${dropdownClassName}`}
        >
          {filteredAndSortedServices.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-muted">
              {allowFreeText 
                 ? (language === "ar" ? `استخدام "${search}" كإجراء مخصص...` : `Use "${search}" as custom procedure...`)
                 : (language === "ar" ? "لم يتم العثور على خدمات" : "No services found")}
            </div>
          ) : (
            groupedServices.map(({ category, items }) => (
              <div key={category.key}>
                <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400 select-none">
                  <DentalIcon id={category.icon} size={13} />
                  {categoryLabel(category.key, language)}
                </div>
                {items.map((service) => {
                  const isSelected = String(service[valueKey]) === String(value);
                  return (
                    <div data-tour="service-option"
                      key={service.id}
                      onClick={() => handleSelect(service)}
                      className={`flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-primary-50 ${
                        isSelected ? "bg-primary-50 font-bold text-primary-700" : "font-medium text-slate-700"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className={`shrink-0 ${isSelected ? "text-primary-600" : "text-slate-400"}`}>
                          <DentalIcon id={iconForService(service as { icon?: string; name?: string; category?: string })} size={19} />
                        </span>
                        <span className="truncate">{label(service)}</span>
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {service.price !== undefined && service.price !== null && (
                          <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs font-bold text-ink-body">
                            {resolveListPrice(service as { price?: number; prices?: Record<string, number> }, priceListId)} EGP
                          </span>
                        )}
                        {isSelected && <Check size={16} className="text-primary-600" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
