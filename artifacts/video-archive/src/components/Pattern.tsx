export function Pattern() {
  return (
    <>
      <div className="bg-pattern fixed inset-0 -z-10 pointer-events-none hidden dark:block blur-[0.8px]" />
      <div className="bg-pattern-light fixed inset-0 -z-10 pointer-events-none dark:hidden blur-[0.8px]" />
    </>
  );
}
