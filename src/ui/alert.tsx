import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const alertVariants = cva("dj-alert relative grid w-full gap-1 rounded-lg border p-4", { variants: { variant: { default: "", warning: "", destructive: "" } }, defaultVariants: { variant: "default" } });

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(({ className, variant, ...props }, ref) => <div ref={ref} role="status" data-variant={variant ?? "default"} className={cn(alertVariants({ variant }), className)} {...props} />);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => <h5 ref={ref} className={cn("dj-type-label", className)} {...props} />);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("dj-type-body-sm text-muted-foreground [&_p]:leading-relaxed", className)} {...props} />);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
