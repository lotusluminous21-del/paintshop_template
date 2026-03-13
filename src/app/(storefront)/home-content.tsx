"use client";

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Droplets, Target, ShieldCheck, Layers, Bot, ArrowRight } from 'lucide-react';
import { CollectionCard } from '@/components/industrial_ui/CollectionCard';
import { ServiceCard } from '@/components/industrial_ui/ServiceCard';
import { Button } from '@/components/ui/button';
import { Product } from '@/lib/shopify/types';
import { FadeInUp, StaggerContainer, IndexedFadeInUp, ImageReveal } from '@/components/ui/motion';

interface CategoryData {
    id: string;
    name: string;
    slug: string;
    icon: string;
    count: number;
}

interface HomeContentProps {
    initialProducts: Product[];
    initialCategories: CategoryData[];
}

export default function HomeContent({ initialProducts, initialCategories }: HomeContentProps) {
    const router = useRouter();

    const handleCategoryClick = (category: string) => {
        router.push(`/categories?category=${encodeURIComponent(category)}`);
    };

    return (
        <>
            {/* Hero Section */}
            <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-10 pt-6 md:pt-16 pb-16 md:pb-24">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 items-center min-h-[auto] md:min-h-[500px]">
                    <div className="flex flex-col justify-center gap-6 md:gap-8 order-2 md:order-1 py-4 md:py-8">
                        <div className="space-y-4">
                            <IndexedFadeInUp index={0}>
                                <span className="inline-block px-3 py-1 bg-primary text-primary-foreground text-[10px] sm:text-xs font-bold uppercase tracking-widest rounded">
                                    Από το 1982
                                </span>
                            </IndexedFadeInUp>
                            <IndexedFadeInUp index={1}>
                                <h1 className="text-5xl sm:text-6xl md:text-7xl font-black leading-[1] md:leading-[0.9] tracking-tighter uppercase text-primary">
                                    Χρώματα <br className="hidden sm:block" /> &amp; Δομικά <br className="hidden sm:block" /> <span className="text-accent">Υλικά.</span>
                                </h1>
                            </IndexedFadeInUp>
                            <IndexedFadeInUp index={2}>
                                <p className="text-muted-foreground text-base sm:text-lg md:text-xl max-w-xl font-light leading-relaxed">
                                    Εμπειρία 44+ χρόνων στον κόσμο του χρώματος. Εξειδικευμένες λύσεις σε χρώματα αυτοκινήτου, ναυτιλιακά, οικοδομικά και δομικά υλικά.
                                </p>
                            </IndexedFadeInUp>
                        </div>
                        <div className="flex flex-col flex-wrap sm:flex-row gap-3 sm:gap-4 mt-4">
                            <IndexedFadeInUp index={3}>
                                <Button asChild className="w-full sm:w-auto rounded-none uppercase tracking-widest font-bold px-6 sm:px-8 py-6 shadow-none" size="lg">
                                    <Link href="/categories">
                                        Δείτε τα Προϊόντα μας
                                    </Link>
                                </Button>
                            </IndexedFadeInUp>
                            <IndexedFadeInUp index={4}>
                                <Button asChild variant="outline" className="w-full sm:w-auto rounded-none uppercase tracking-widest font-bold px-6 sm:px-8 py-6 shadow-none border-primary text-primary hover:bg-muted" size="lg">
                                    <Link href="/contact">
                                        Επικοινωνήστε μαζί μας
                                    </Link>
                                </Button>
                            </IndexedFadeInUp>
                        </div>
                    </div>
                    <ImageReveal delay={0.2} className="order-1 md:order-2 h-[300px] sm:h-[400px] md:h-[600px] w-full relative">
                        <div className="absolute inset-0 bg-center bg-no-repeat bg-cover transition-all duration-700 border border-border"
                            style={{ backgroundImage: 'url("/images/homescreen/hero.webp")' }}>
                        </div>
                    </ImageReveal>
                </div>
            </section>

            {/* Featured Collections */}
            <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-10 py-16 md:py-24">
                <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 sm:gap-0 mb-8 md:mb-10 border-b border-border pb-4 md:pb-6">
                    <StaggerContainer staggerDelay={0.25}>
                        <FadeInUp inStaggerGroup>
                            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-primary">Κατηγορίες</h2>
                        </FadeInUp>
                        <FadeInUp inStaggerGroup>
                            <p className="text-muted-foreground text-xs sm:text-sm uppercase tracking-widest mt-1">Κατηγορίες Προϊόντων</p>
                        </FadeInUp>
                    </StaggerContainer>
                    <FadeInUp inStaggerGroup>
                        <Link href="/categories" className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-accent hover:underline hover:text-primary transition-colors">
                            Δείτε Όλα <ChevronRight className="w-4 h-4" />
                        </Link>
                    </FadeInUp>
                </div>

                <StaggerContainer staggerDelay={0.25} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                    <FadeInUp inStaggerGroup>
                        <CollectionCard
                            title="Οικοδομικά Χρώματα"
                            description="Πλήρης γκάμα χρωμάτων για εσωτερικούς και εξωτερικούς χώρους με υψηλή κάλυψη και αντοχή."
                            image="/images/homescreen/building.webp"
                            variant="featured"
                            onClick={() => handleCategoryClick('construction')}
                        />
                    </FadeInUp>

                    <FadeInUp inStaggerGroup>
                        <CollectionCard
                            title="Χρώματα Αυτοκινήτου"
                            description="Επαγγελματικά χρώματα και προϊόντα φανοποιίας για τέλειο αποτέλεσμα σε κάθε επισκευή."
                            image="/images/homescreen/automotive.webp"
                            variant="featured"
                            onClick={() => handleCategoryClick('automotive')}
                        />
                    </FadeInUp>

                    <FadeInUp inStaggerGroup>
                        <CollectionCard
                            title="Ναυτιλιακά Χρώματα"
                            description="Εξειδικευμένα προϊόντα για σκάφη και θαλάσσιες εφαρμογές με αντοχή στο αλάτι και την υγρασία."
                            image="/images/homescreen/marine.webp"
                            variant="featured"
                            onClick={() => handleCategoryClick('marine')}
                        />
                    </FadeInUp>

                    <FadeInUp inStaggerGroup>
                        <CollectionCard
                            title="Ειδικές Εφαρμογές"
                            description="Εξειδικευμένες λύσεις και υλικά για ιδιαίτερα project όπως πισίνες, βιομηχανικά δάπεδα και ειδικές επιφάνειες."
                            image="/images/homescreen/special.webp"
                            variant="featured"
                            onClick={() => handleCategoryClick('special')}
                        />
                    </FadeInUp>
                </StaggerContainer>
            </section>

            {/* AI Expert CTA Banner */}
            <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-10 py-16 md:py-24">
                <StaggerContainer staggerDelay={0.1} viewportAmount={0.5} className="bg-[#19657a] text-white flex border border-transparent flex-col md:flex-row items-center justify-between p-6 sm:p-8 md:px-12 md:py-8 relative overflow-hidden shadow-lg">
                    {/* Background Pattern */}
                    <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '16px 16px' }}></div>

                    <div className="flex flex-col md:flex-row items-center md:items-center gap-6 md:gap-8 relative z-10 w-full">
                        <FadeInUp className="flex-shrink-0 hidden sm:flex">
                            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#124a59] rounded-none flex items-center justify-center border border-white/10 shadow-inner">
                                <Bot className="w-8 h-8 sm:w-10 sm:h-10 text-white opacity-90" />
                            </div>
                        </FadeInUp>
                        <div className="flex flex-col justify-center text-center md:text-left flex-1 min-w-0">
                            <FadeInUp>
                                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#124a59] text-white border border-white/10 text-[10px] sm:text-xs font-bold uppercase tracking-widest rounded-sm mb-3 md:mb-2 mx-auto md:mx-0 w-fit">
                                    <Bot className="w-3 h-3 sm:hidden" />
                                    <span>AI Assistant</span>
                                </div>
                            </FadeInUp>
                            <FadeInUp>
                                <h2 className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-tighter text-white mb-2 md:mb-1.5">
                                    Δεν ειστε σιγουροι τι χρειαζεστε;
                                </h2>
                            </FadeInUp>
                            <FadeInUp>
                                <p className="text-white/80 text-xs sm:text-sm font-medium leading-relaxed max-w-3xl mx-auto md:mx-0">
                                    Ανεβάστε μια φωτογραφία του χώρου σας ή περιγράψτε μας το project σας. Ο <strong>AI Expert</strong> μας θα σας προτείνει τα ιδανικά υλικά και χρώματα.
                                </p>
                            </FadeInUp>
                        </div>
                        <FadeInUp className="mt-2 md:mt-0 flex-shrink-0 w-full md:w-auto self-center flex items-center">
                            <Button asChild className="w-full md:w-auto rounded-none uppercase tracking-widest font-bold px-6 py-6 sm:px-8 sm:py-6 bg-white text-[#19657a] hover:bg-gray-100 shadow-xl group/btn transition-colors" size="lg">
                                <Link href="/expert" className="flex items-center justify-center gap-2">
                                    Ρωτηστε τον Expert
                                    <ArrowRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-1" />
                                </Link>
                            </Button>
                        </FadeInUp>
                    </div>
                </StaggerContainer>
            </section>

            {/* Professional Services */}
            <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-10 py-16 md:py-24">
                <div className="bg-[#0b1120] text-primary-foreground border border-[#1e293b]">
                    <div className="flex flex-col lg:flex-row">
                        <StaggerContainer staggerDelay={0.3} viewportAmount={0.3} className="flex-1 p-6 sm:p-8 md:p-12 lg:p-16 space-y-8 md:space-y-12">
                            <StaggerContainer staggerDelay={0.25}>
                                <FadeInUp inStaggerGroup>
                                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-black uppercase tracking-tighter mb-4 !text-white">Οι Υπηρεσίες μας</h2>
                                </FadeInUp>
                                <FadeInUp inStaggerGroup>
                                    <p className="text-white/70 text-base sm:text-lg font-light leading-relaxed max-w-xl">
                                        Δεν προσφέρουμε μόνο υλικά. Προσφέρουμε εξειδικευμένη γνώση και τεχνική υποστήριξη, από color matching έως συμβουλές χρωματισμού για κάθε εφαρμογή.
                                    </p>
                                </FadeInUp>
                            </StaggerContainer>
                            <StaggerContainer staggerDelay={0.25} className="grid grid-cols-1 sm:grid-cols-2 gap-8 w-full">
                                <FadeInUp inStaggerGroup>
                                    <ServiceCard
                                        icon={<Target className="w-8 h-8 text-accent" />}
                                        title="Τεχνική Συμβουλευτική"
                                        description="Καθοδήγηση στην επιλογή των κατάλληλων προϊόντων για οικοδομική, ναυτιλιακή ή αυτοκινητιστική χρήση."
                                        iconColor="accent"
                                        className="!text-white [&_h4]:!text-white [&_h4]:hover:text-[#19657a] [&_p]:text-white/60"
                                    />
                                </FadeInUp>
                                <FadeInUp inStaggerGroup>
                                    <ServiceCard
                                        icon={<Droplets className="w-8 h-8 text-accent" />}
                                        title="Παρασκευή Αποχρώσεων"
                                        description="Custom αποχρώσεις σύμφωνα με τις ανάγκες σας, από δείγμα ή μοναδική ιδέα, στο εξειδικευμένο εργαστήριό μας."
                                        iconColor="accent"
                                        className="!text-white [&_h4]:!text-white [&_h4]:hover:text-[#19657a] [&_p]:text-white/60"
                                    />
                                </FadeInUp>
                                <FadeInUp inStaggerGroup>
                                    <ServiceCard
                                        icon={<ShieldCheck className="w-8 h-8 text-accent" />}
                                        title="Μελέτη Color Matching"
                                        description="Επαγγελματική αντιστοίχιση χρωμάτων με εξειδικευμένο εξοπλισμό για άψογο αποτέλεσμα."
                                        iconColor="accent"
                                        className="!text-white [&_h4]:!text-white [&_h4]:hover:text-[#19657a] [&_p]:text-white/60"
                                    />
                                </FadeInUp>
                                <FadeInUp inStaggerGroup>
                                    <ServiceCard
                                        icon={<Layers className="w-8 h-8 text-accent" />}
                                        title="Συμβουλές Χρωματισμού"
                                        description="Ιδανικοί χρωματικοί συνδυασμοί για τον χώρο σας, με βάση τις σύγχρονες τάσεις και τις ανάγκες σας."
                                        iconColor="accent"
                                        className="!text-white [&_h4]:!text-white [&_h4]:hover:text-[#19657a] [&_p]:text-white/60"
                                    />
                                </FadeInUp>
                            </StaggerContainer>
                        </StaggerContainer>
                        <FadeInUp inStaggerGroup delay={0.3} className="lg:w-1/3 flex-none relative h-[300px] sm:h-[400px] lg:h-auto">
                            <div className="absolute inset-0 bg-cover bg-center grayscale border border-[#1e293b]"
                                style={{ backgroundImage: 'url("/images/homescreen/services.webp")' }}>
                            </div>
                            <FadeInUp inStaggerGroup delay={0.6} className="absolute -bottom-6 -left-6 bg-[#19657a] text-white p-6 z-10 hidden lg:block">
                                <p className="text-3xl font-black italic">44+</p>
                                <p className="text-[10px] uppercase font-bold tracking-[0.2em]">Χρόνια Εμπειρίας</p>
                            </FadeInUp>
                        </FadeInUp>
                    </div>
                </div>
            </section>
        </>
    );
}
