import "vue";

declare module "vue" {
  interface HTMLAttributes {
    children?: unknown;
  }

  interface ButtonHTMLAttributes {
    children?: unknown;
  }
}
