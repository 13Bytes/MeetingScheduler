import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RoutePlaceholder({
  icon: Icon,
  eyebrow = "Feature",
  title,
  description,
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <Badge>{eyebrow}</Badge>
          <span className="rounded-md border border-border bg-surface-muted p-2 text-primary">
            <Icon className="size-5" aria-hidden="true" />
          </span>
        </div>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-slate-600">{description}</p>
      </CardContent>
    </Card>
  );
}
