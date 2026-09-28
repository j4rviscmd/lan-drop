import { useServerInfo } from "@hooks/useServerInfo";
import { TransfersProvider } from "@hooks/useTransfers";
import { Shell } from "@components/Shell";
import { Toaster } from "@ui/sonner";

export default function App() {
  const info = useServerInfo();

  return (
    <>
      {info ? (
        <TransfersProvider loopbackPort={info.loopback_port}>
          <Shell info={info} />
        </TransfersProvider>
      ) : (
        <main className="mx-auto max-w-[640px] p-5">
          <h1 className="m-0 text-[22px] font-semibold">
            lan<span className="text-primary">·</span>drop
          </h1>
          <p className="mt-1 mb-0 text-[13px] text-muted-foreground">starting server…</p>
        </main>
      )}
      <Toaster position="bottom-right" richColors />
    </>
  );
}
