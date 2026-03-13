'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle, ShieldCheck, Factory, Award, HeartPulse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IndexedFadeInUp, StaggerContainer, FadeInUp, ImageReveal } from '@/components/ui/motion';

export default function AboutClient() {
    return (
        <>
            {/* ───── Hero Section ───── */}
            <section className="relative flex items-center overflow-hidden bg-black min-h-[50vh] md:min-h-[60vh]">
                {/* Background Image */}
                <ImageReveal delay={0.1} className="absolute inset-0">
                    <Image
                        src="/images/about/hero.webp"
                        alt="Κατάστημα χρωμάτων και δομικών υλικών Παυλιτσέβιτς"
                        fill
                        className="object-cover grayscale brightness-50"
                        sizes="100vw"
                        priority
                    />
                </ImageReveal>
                {/* Gradient Overlays */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
                <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent" />

                {/* Content */}
                <div className="relative max-w-7xl mx-auto px-6 md:px-10 w-full py-16 md:py-24">
                    <div className="max-w-2xl space-y-6">
                        <IndexedFadeInUp index={0}>
                            <span className="inline-block px-3 py-1 bg-accent text-white text-[10px] font-black uppercase tracking-[0.25em]">
                                Από το 1982
                            </span>
                        </IndexedFadeInUp>

                        <IndexedFadeInUp index={1}>
                            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white leading-[0.9] tracking-tighter uppercase">
                                Η Εταιρία <br />
                                <span className="text-white/50 italic">μας.</span>
                            </h1>
                        </IndexedFadeInUp>

                        <IndexedFadeInUp index={2}>
                            <p className="text-lg text-white/70 font-light leading-relaxed border-l-2 border-white/30 pl-6 max-w-lg">
                                Από το 1982 στον χώρο των χρωμάτων με συνέπεια, γνώση και αφοσίωση στην ποιότητα. Σημείο αναφοράς για επαγγελματίες και ιδιώτες στη Θεσσαλονίκη.
                            </p>
                        </IndexedFadeInUp>
                    </div>
                </div>
            </section>

            {/* ───── Stats / Heritage Section ───── */}
            <section className="py-16 md:py-24 border-b border-border">
                <div className="max-w-7xl mx-auto px-6 md:px-10">
                    <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-12 md:gap-16">
                        {[
                            {
                                value: '44+',
                                label: 'Χρόνια Εμπειρίας',
                                description: 'Ίδρυση το 1982 ως αντιπρόσωπος γερμανικής εταιρίας χρωμάτων, εξέλιξη σε σημείο αναφοράς στη Β. Ελλάδα.',
                                color: 'text-primary',
                            },
                            {
                                value: '4',
                                label: 'Κατηγορίες Εξειδίκευσης',
                                description: 'Οικοδομικά, αυτοκινήτου, ναυτιλιακά χρώματα και ειδικές εφαρμογές — πλήρης κάλυψη αναγκών.',
                                color: 'text-accent',
                            },
                            {
                                value: '1000+',
                                label: 'Ικανοποιημένοι Πελάτες',
                                description: 'Χιλιάδες επαγγελματίες και ιδιώτες εμπιστεύονται τα προϊόντα και την τεχνογνωσία μας.',
                                color: 'text-muted-foreground',
                            },
                        ].map((stat) => (
                            <FadeInUp inStaggerGroup key={stat.label} className="space-y-4">
                                <span className="text-5xl md:text-6xl font-black text-foreground tracking-tighter">
                                    {stat.value}
                                </span>
                                <h3 className={`text-xs font-black uppercase tracking-[0.2em] ${stat.color}`}>
                                    {stat.label}
                                </h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {stat.description}
                                </p>
                            </FadeInUp>
                        ))}
                    </StaggerContainer>
                </div>
            </section>

            {/* ───── Quality Management Section ───── */}
            <section className="py-16 md:py-24">
                <div className="max-w-7xl mx-auto px-6 md:px-10">
                    <div className="flex flex-col md:flex-row gap-12 md:gap-20 items-center">
                        {/* Image with decorative corner */}
                        <div className="w-full md:w-1/2 relative">
                            <div className="absolute -top-4 -left-4 w-24 h-24 border-t-2 border-l-2 border-accent z-10" />
                            <ImageReveal delay={0.2} className="relative aspect-[4/3] w-full overflow-hidden shadow-2xl">
                                <Image
                                    src="/images/about/detail.webp"
                                    alt="Εξειδικευμένα χρώματα και δομικά υλικά Παυλιτσέβιτς"
                                    fill
                                    className="object-cover grayscale"
                                    sizes="(max-width: 768px) 100vw, 50vw"
                                />
                            </ImageReveal>
                        </div>

                        {/* Text Content */}
                        <div className="w-full md:w-1/2 space-y-8">
                            <FadeInUp>
                                <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-foreground">
                                    Η Φιλοσοφία <br />μας
                                </h2>
                            </FadeInUp>
                            <FadeInUp delay={0.1}>
                                <p className="text-muted-foreground leading-loose">
                                    Η δέσμευσή μας στην ποιότητα αποτυπώνεται σε κάθε πτυχή της λειτουργίας μας. Παρακολουθούμε συνεχώς τις τεχνολογικές εξελίξεις, τις οποίες προσαρμόζουμε στα ελληνικά δεδομένα, προσφέροντας εξατομικευμένες λύσεις για κάθε ανάγκη.
                                </p>
                            </FadeInUp>
                            <StaggerContainer className="space-y-4" staggerDelay={0.15}>
                                {[
                                    'Επιλογή προϊόντων υψηλών προδιαγραφών',
                                    'Συνεχής ενημέρωση & τεχνολογική εξέλιξη',
                                    'Εξατομικευμένη εξυπηρέτηση πελατών',
                                ].map((item) => (
                                    <FadeInUp
                                        inStaggerGroup
                                        key={item}
                                        className="flex items-center gap-3 text-xs font-black uppercase tracking-widest text-foreground"
                                    >
                                        <CheckCircle className="w-5 h-5 text-accent flex-shrink-0" />
                                        {item}
                                    </FadeInUp>
                                ))}
                            </StaggerContainer>
                        </div>
                    </div>
                </div>
            </section>

            {/* ───── Why Choose Us Section ───── */}
            <section className="py-16 md:py-24 bg-secondary/30">
                <div className="max-w-7xl mx-auto px-6 md:px-10">
                    <div className="mb-12 md:mb-16 text-center">
                        <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter mb-4 text-foreground">
                            Γιατί να μας Επιλέξετε
                        </h2>
                        <div className="w-20 h-1 bg-accent mx-auto" />
                    </div>

                    <StaggerContainer className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
                        {[
                            { icon: <ShieldCheck className="w-8 h-8" />, name: '44+ Χρόνια', subtitle: 'Εμπειρίας στον χώρο' },
                            { icon: <Factory className="w-8 h-8" />, name: 'Ευρεία Γκάμα', subtitle: 'Προϊόντα για κάθε εφαρμογή' },
                            { icon: <Award className="w-8 h-8" />, name: 'Τεχνική Υποστήριξη', subtitle: 'Εξειδικευμένη καθοδήγηση' },
                            { icon: <HeartPulse className="w-8 h-8" />, name: 'Προσωπική', subtitle: 'Εξυπηρέτηση πελατών' },
                        ].map((cert) => (
                            <FadeInUp
                                inStaggerGroup
                                key={cert.name}
                                className="group bg-background border border-border p-6 md:p-10 flex flex-col items-center justify-center text-center hover:border-primary transition-colors cursor-default"
                            >
                                <div className="mb-4 text-muted-foreground group-hover:text-primary transition-colors">
                                    {cert.icon}
                                </div>
                                <h4 className="text-[11px] md:text-xs font-black uppercase tracking-widest text-foreground">
                                    {cert.name}
                                </h4>
                                <p className="text-[10px] mt-2 text-muted-foreground uppercase tracking-wide">
                                    {cert.subtitle}
                                </p>
                            </FadeInUp>
                        ))}
                    </StaggerContainer>
                </div>
            </section>

            {/* ───── CTA Section ───── */}
            <section className="py-16 md:py-24 bg-[#19657a]">
                <div className="max-w-4xl mx-auto px-6 md:px-10 text-center">
                    <FadeInUp>
                        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter mb-8 leading-tight text-white">
                            Ψάχνετε λύσεις σε χρώματα ή δομικά υλικά; Είμαστε δίπλα σας.
                        </h2>
                    </FadeInUp>
                    <FadeInUp delay={0.2} className="flex flex-col sm:flex-row justify-center gap-4 sm:gap-6">
                        <Link href="/contact">
                            <Button
                                variant="secondary"
                                size="lg"
                                className="rounded-none px-8 md:px-10 py-6 text-xs font-black uppercase tracking-widest w-full sm:w-auto shadow-none"
                            >
                                Επικοινωνήστε μαζί μας
                            </Button>
                        </Link>
                        <Link href="/">
                            <Button
                                variant="outline"
                                size="lg"
                                className="rounded-none px-8 md:px-10 py-6 text-xs font-black uppercase tracking-widest border-white/30 text-white bg-transparent hover:bg-white/10 w-full sm:w-auto shadow-none"
                            >
                                Δείτε τα Προϊόντα μας
                            </Button>
                        </Link>
                    </FadeInUp>
                </div>
            </section>
        </>
    );
}
