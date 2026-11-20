import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RoutePlaceholder({
  icon: Icon,
  eyebrow,
  title,
  description,
  link,
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  description: string;
  link?: { href: string; label: string };
}) {
  const iconBox = (
    <span className="shrink-0 rounded-md border border-border bg-surface-muted p-2 text-primary">
      <Icon className="size-5" aria-hidden="true" />
    </span>
  );

  return (
    <Card>
      <CardHeader>
        {eyebrow ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <Badge>{eyebrow}</Badge>
              {iconBox}
            </div>
            <CardTitle>{title}</CardTitle>
          </>
        ) : (
          <div className="flex items-center gap-3">
            {iconBox}
            <CardTitle>{title}</CardTitle>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-6 text-slate-600">{description}</p>
        {link ? (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {link.label}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}
