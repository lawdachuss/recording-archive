import { Fragment, useState, useEffect, Children, type HTMLAttributes, type ReactNode } from "react";
import { Check } from "lucide-react";

interface StepperProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void;
  backButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  backButtonText?: string;
  nextButtonText?: string;
  canNext?: boolean;
  hideNext?: boolean;
}

export default function Stepper({
  children,
  initialStep = 1,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  backButtonProps = {},
  nextButtonProps = {},
  backButtonText = "Back",
  nextButtonText = "Continue",
  canNext = true,
  hideNext = false,
  ...rest
}: StepperProps) {
  const [currentStep, setCurrentStep] = useState<number>(initialStep);
  const stepsArray = Children.toArray(children);
  const totalSteps = stepsArray.length;
  const isCompleted = currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;

  useEffect(() => {
    setCurrentStep(initialStep);
  }, [initialStep]);

  const updateStep = (newStep: number) => {
    setCurrentStep(newStep);
    if (newStep > totalSteps) {
      onFinalStepCompleted();
    } else {
      onStepChange(newStep);
    }
  };

  return (
    <div {...rest}>
      <div className="flex w-full items-center px-1 pt-1 pb-3">
        {stepsArray.map((_, index) => {
          const stepNumber = index + 1;
          const isNotLastStep = index < totalSteps - 1;
          return (
            <Fragment key={stepNumber}>
              <StepIndicator
                step={stepNumber}
                currentStep={currentStep}
                onClickStep={updateStep}
              />
              {isNotLastStep && <StepConnector isComplete={currentStep > stepNumber} />}
            </Fragment>
          );
        })}
      </div>

      <div className="min-h-[180px]">
        {!isCompleted ? stepsArray[currentStep - 1] : null}
      </div>

      {!isCompleted && !hideNext && (
        <div className="pt-4">
          <div className={`flex ${currentStep !== 1 ? "justify-between" : "justify-end"}`}>
            {currentStep !== 1 && (
              <button
                onClick={() => updateStep(currentStep - 1)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-sm"
                {...backButtonProps}
              >
                {backButtonText}
              </button>
            )}
            <button
              onClick={isLastStep ? () => updateStep(totalSteps + 1) : () => updateStep(currentStep + 1)}
              disabled={!canNext}
              className="px-4 py-1.5 text-xs font-medium rounded-sm border border-primary/30 text-primary hover:border-primary/60 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              {...nextButtonProps}
            >
              {isLastStep ? nextButtonText : nextButtonText}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({
  step,
  currentStep,
  onClickStep,
}: {
  step: number;
  currentStep: number;
  onClickStep: (clicked: number) => void;
}) {
  const status = currentStep === step ? "active" : currentStep < step ? "inactive" : "complete";

  return (
    <button
      onClick={() => {
        if (step !== currentStep) onClickStep(step);
      }}
      className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-all duration-200 ${
        status === "complete"
          ? "bg-primary text-primary-foreground"
          : status === "active"
            ? "bg-primary/20 text-primary ring-1 ring-primary/40"
            : "bg-secondary text-muted-foreground/50"
      } ${step === currentStep ? "" : "cursor-pointer"}`}
    >
      {status === "complete" ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <span>{step}</span>
      )}
    </button>
  );
}

function StepConnector({ isComplete }: { isComplete: boolean }) {
  return (
    <div className="flex-1 mx-1.5 h-px bg-border/40 relative overflow-hidden">
      <div
        className={`absolute inset-0 bg-primary transition-transform duration-300 origin-left ${
          isComplete ? "scale-x-100" : "scale-x-0"
        }`}
      />
    </div>
  );
}

interface StepProps {
  children: ReactNode;
}

export function Step({ children }: StepProps) {
  return <div>{children}</div>;
}
