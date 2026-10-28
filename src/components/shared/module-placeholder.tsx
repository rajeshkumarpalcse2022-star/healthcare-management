import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { APP_NAME } from "@/config/constants";
import type { IconComponent } from "@/types/navigation";

export interface ModulePlaceholderProps {
  title: string;
  description: string;
  icon: IconComponent;
}

/**
 * Uniform scaffold screen for every module route that exists in the
 * navigation but has no business functionality yet.
 */
export function ModulePlaceholder({
  title,
  description,
  icon: Icon,
}: ModulePlaceholderProps) {
  return (
    <>
      <PageHeader
        eyebrow="Module"
        title={title}
        description={description}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: title }]}
      />

      <Card>
        <CardContent className="flex flex-col items-center py-12 text-center sm:py-16">
          <span
            className="flex size-14 items-center justify-center rounded-2xl bg-primary-light text-primary-hover dark:bg-primary/10 dark:text-brand-400"
            aria-hidden="true"
          >
            <Icon className="size-7" />
          </span>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              {title} shell is ready
            </h2>
            <Badge variant="neutral">Not implemented yet</Badge>
          </div>

          <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-ink-muted">
            This route, its navigation entry and the {APP_NAME} layout are
            wired up. Business screens, data models and workflows for this
            module are added in a later step.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
