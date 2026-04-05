/**
 * PropertyCombobox — reusable searchable property selector.
 *
 * Renders a Popover + Command combo that:
 * - Shows a search input so users can filter 100+ properties by name
 * - Sorts properties alphabetically by display name
 * - Supports an optional "All Properties" sentinel value
 * - Matches the visual style of the rest of the app (shadcn/ui)
 *
 * Usage:
 *   <PropertyCombobox
 *     properties={listings}          // { id: string|number; name: string }[]
 *     value={propertyFilter}         // current value ("all" or string id)
 *     onValueChange={setPropertyFilter}
 *     allLabel="All Properties (114)"  // optional, defaults to "All Properties"
 *     placeholder="Select property…"  // optional trigger placeholder
 *     className="w-[180px]"           // optional width on the trigger button
 *   />
 */
import { useState } from "react";
import { Check, ChevronsUpDown, Building } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface PropertyOption {
  id: string | number;
  name: string;
  /** Optional secondary label shown below the name (e.g. task count) */
  sublabel?: string;
}

interface PropertyComboboxProps {
  properties: PropertyOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Label for the "show all" sentinel item. Pass undefined to hide it. */
  allLabel?: string;
  /** Placeholder text shown on the trigger button when nothing is selected */
  placeholder?: string;
  /** Extra class names applied to the trigger button */
  className?: string;
  /** Whether to show the building icon on the trigger */
  showIcon?: boolean;
  /** Disabled state */
  disabled?: boolean;
}

export function PropertyCombobox({
  properties,
  value,
  onValueChange,
  allLabel = "All Properties",
  placeholder = "Select property…",
  className,
  showIcon = false,
  disabled = false,
}: PropertyComboboxProps) {
  const [open, setOpen] = useState(false);

  // Sort alphabetically by display name
  const sorted = [...properties].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
  );

  const selectedOption =
    value && value !== "all"
      ? sorted.find((p) => String(p.id) === String(value))
      : null;

  const triggerLabel = selectedOption
    ? selectedOption.name
    : value === "all" && allLabel
    ? allLabel
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "justify-between font-normal bg-background text-left",
            className
          )}
        >
          <span className="flex items-center gap-1.5 truncate min-w-0">
            {showIcon && (
              <Building className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate text-sm">{triggerLabel}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        // Prevent the popover from closing when clicking inside the command
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command
          filter={(itemValue, search) => {
            // Case-insensitive substring match
            if (!search) return 1;
            return itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search properties…" />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>No properties found.</CommandEmpty>
            <CommandGroup>
              {/* "All Properties" sentinel */}
              {allLabel !== undefined && (
                <CommandItem
                  value={allLabel}
                  onSelect={() => {
                    onValueChange("all");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === "all" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {allLabel}
                </CommandItem>
              )}
              {sorted.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name + (p.sublabel ? ` ${p.sublabel}` : "")}
                  onSelect={() => {
                    onValueChange(String(p.id));
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      String(p.id) === String(value) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="flex flex-col">
                    <span>{p.name}</span>
                    {p.sublabel && (
                      <span className="text-xs text-muted-foreground">
                        {p.sublabel}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
