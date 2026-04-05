import { useState, useEffect, useCallback } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Archive,
  Clock,
  Inbox,
  Mail,
  MailOpen,
  Reply,
  Search,
  Sparkles,
  Star,
  Tag,
  RefreshCw,
  Settings,
  DollarSign,
  Wrench,
  LayoutDashboard,
} from "lucide-react";
import { useLocation } from "wouter";

interface VivCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction?: (action: string) => void;
}

export default function VivCommandPalette({
  open,
  onOpenChange,
  onAction,
}: VivCommandPaletteProps) {
  const [, setLocation] = useLocation();

  const handleSelect = (action: string) => {
    onOpenChange(false);

    // Navigation actions
    if (action.startsWith("nav:")) {
      setLocation(action.replace("nav:", ""));
      return;
    }

    // Delegate to parent
    if (onAction) {
      onAction(action);
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Viv Actions">
          <CommandItem onSelect={() => handleSelect("triage")}>
            <Sparkles className="mr-2 h-4 w-4 text-viv-gold" />
            <span>AI Triage Inbox</span>
            <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">t</kbd>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("reply")}>
            <Reply className="mr-2 h-4 w-4" />
            <span>Reply with AI Draft</span>
            <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">r</kbd>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("archive")}>
            <Archive className="mr-2 h-4 w-4" />
            <span>Archive Email</span>
            <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">e</kbd>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("star")}>
            <Star className="mr-2 h-4 w-4" />
            <span>Toggle Star</span>
            <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">s</kbd>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("snooze")}>
            <Clock className="mr-2 h-4 w-4" />
            <span>Snooze Email</span>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("mark-read")}>
            <MailOpen className="mr-2 h-4 w-4" />
            <span>Toggle Read/Unread</span>
            <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">u</kbd>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("refresh")}>
            <RefreshCw className="mr-2 h-4 w-4" />
            <span>Refresh Inbox</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Viv Views">
          <CommandItem onSelect={() => handleSelect("nav:/viv")}>
            <Inbox className="mr-2 h-4 w-4" />
            <span>Inbox — All</span>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("filter:important")}>
            <Mail className="mr-2 h-4 w-4" />
            <span>Inbox — Important Only</span>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("filter:other")}>
            <Mail className="mr-2 h-4 w-4" />
            <span>Inbox — Other</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Wand Navigation">
          <CommandItem onSelect={() => handleSelect("nav:/")}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("nav:/billing")}>
            <DollarSign className="mr-2 h-4 w-4" />
            <span>Run Billing</span>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("nav:/breezeway/tasks")}>
            <Wrench className="mr-2 h-4 w-4" />
            <span>Breezeway Tasks</span>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect("nav:/settings")}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/**
 * Hook to manage command palette state with Cmd+K shortcut.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}
