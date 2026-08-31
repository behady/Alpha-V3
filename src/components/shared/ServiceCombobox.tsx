"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, ChevronDown, Check } from "lucide-react";
import { DENTAL_CATEGORIES, DentalIcon, categoryLabel, iconForService, suggestCategory } from "@/lib/dentalIcons";

export interface ComboboxService {
  id: string | number;
  name: string;
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
}

export default function ServiceCombobox({
  services,
  value,
  onChange,
  valueKey = "id",
  placeholder,
  disabled = false,
  allowFreeText = false,
  language = "en",
  className = "",
  dropdownClassName = "",
}: ServiceComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Derive the display text from the selected value
  const selectedService = useMemo(
    () => services.find((s) => String(s[valueKey]) === String(value)),
    [services, value, valueKey]
  );

  // Sync internal search state with selected value
  useEffect(() => {
    if (!isOpen) {
      if (selectedService) {
        setSearch(selectedService.name);
      } else if (allowFreeText) {
        setSearch(value || "");
      } else {
        setSearch("");
      }
    } else if (value && !search && allowFreeText) {
       // Backup sync if opened and empty
       setSearch(value);
    }
  }, [isOpen, selectedService, value, allowFreeText, search]);

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
      filtered = services.filter((s) => s.name.toLowerCase().includes(lowerSearch));
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
      setIsOpen(true);
    }
  };

  const handleBlur = () => {
    // Delay slightly so onClick on items can fire
    setTimeout(() => {
      if (allowFreeText && search.trim() && !selectedService && isOpen) {
        onChange(search.trim());
      }
    }, 150);
  };

  return (
    <div className={`relative ${className}`} ref={containerRef} dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={search || (allowFreeText ? value : "")}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
            // If they clear the input, clear the value
            if (e.target.value === "") {
                onChange("");
            }
          }}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
              if (selectedService) {
                 // Select all text on focus to make replacing easy
                 setTimeout(() => inputRef.current?.select(), 0);
              }
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
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
                 setIsOpen(!isOpen);
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
                    <div
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
                        <span className="truncate">{service.name}</span>
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {service.price !== undefined && service.price !== null && (
                          <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs font-bold text-ink-body">
                            {service.price} EGP
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
