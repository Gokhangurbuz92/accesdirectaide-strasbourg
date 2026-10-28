import { Button } from "@/components/ui/button";

export default function SentryTest() {
    const throwError = () => {
        throw new Error("Sentry Test Error: Manually triggered for verification.");
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-red-50">
            <h1 className="text-2xl font-bold mb-4 text-red-700">Test Sentry Integration</h1>
            <p className="mb-8 text-center max-w-md text-red-600">
                This page exists to verify error reporting.
                Clicking the button below will intentionally crash the React component.
            </p>
            <Button variant="destructive" onClick={throwError}>
                Trigger Error
            </Button>
        </div>
    );
}
