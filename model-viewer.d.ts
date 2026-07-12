import type { DetailedHTMLProps, HTMLAttributes } from "react";

type ModelViewerProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string;
  alt?: string;
  ar?: boolean;
  "auto-rotate"?: boolean;
  "camera-controls"?: boolean;
  "shadow-intensity"?: string | number;
  exposure?: string | number;
  poster?: string;
  loading?: string;
  reveal?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerProps;
    }
  }
}

export {};
