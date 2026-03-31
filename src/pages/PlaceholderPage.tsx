import { useLanguage } from "@/contexts/LanguageContext";
import { Construction } from "lucide-react";

interface PlaceholderPageProps {
  titleKey: string;
}

const PlaceholderPage = ({ titleKey }: PlaceholderPageProps) => {
  const { t } = useLanguage();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary">
        <Construction className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">
          {t(titleKey as any)}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t("placeholder.title")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground/70">
          {t("placeholder.message")}
        </p>
      </div>
    </div>
  );
};

export default PlaceholderPage;
