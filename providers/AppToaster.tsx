// /providers/AppToaster.tsx
"use client";

import { Toaster } from "react-hot-toast";

export default function AppToaster() {
  return (
    <Toaster
      position="top-center"
      gutter={10}
      containerClassName="pwa-toaster"
      containerStyle={{ zIndex: 2147483647 }}
      toastOptions={{
        style: {
          zIndex: 2147483647,
          background: "rgba(24,24,27,0.9)",
          color: "white",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(8px)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        },
        success: {
          iconTheme: { primary: "rgb(182,255,62)", secondary: "#111111" },
        },
      }}
    />
  );
}
