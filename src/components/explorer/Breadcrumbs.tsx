import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ui/breadcrumb";

import type { Scope } from "@lib/types";

interface BreadcrumbsProps {
  scope: Scope;
  cwd: string[];
  onNavigate: (scope: Scope, cwd: string[]) => void;
}

/** iPhone / [scope] / …cwd segments. Links jump; the last segment is static. */
export function Breadcrumbs({ scope, cwd, onNavigate }: BreadcrumbsProps) {
  const scopeName = scope?.type === "app" ? scope.name : "Media";

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-wrap text-[13px] [overflow-wrap:anywhere]">
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <button type="button" onClick={() => onNavigate(null, [])}>
              iPhone
            </button>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {scope ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {cwd.length === 0 ? (
                <BreadcrumbPage>{scopeName}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <button type="button" onClick={() => onNavigate(scope, [])}>
                    {scopeName}
                  </button>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </>
        ) : null}

        {cwd.map((seg, i) => (
          <Fragment key={`${i}-${seg}`}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {i + 1 === cwd.length ? (
                <BreadcrumbPage>{seg}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <button type="button" onClick={() => onNavigate(scope, cwd.slice(0, i + 1))}>
                    {seg}
                  </button>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
