'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Layers, Palette, ShieldCheck, Wrench, Droplets, Target } from 'lucide-react';
import { IndexedFadeInUp, StaggerContainer, FadeInUp, ImageReveal } from '@/components/ui/motion';

export default function ServicesClient() {
    return (
        <>
            {/* ───── Hero Section ───── */}
            <section className="relative flex items-end overflow-hidden min-h-[45vh] md:min-h-[50vh]">
                {/* Background Image */}
                <ImageReveal delay={0.1} className="absolute inset-0">
                    <Image
                        src="/images/services/hero.webp"
                        alt="Εξειδικευμένες υπηρεσίες χρωμάτων Παυλιτσέβιτς"
                        fill
                        className="object-cover grayscale brightness-50"
                        sizes="100vw"
                        priority
                    />
                </ImageReveal>
                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />

                {/* Content */}
                <div className="relative z-10 max-w-7xl mx-auto w-full px-6 md:px-10 pb-10 md:pb-14">
                    <div className="max-w-2xl space-y-6">
                        <IndexedFadeInUp index={0}>
                            <span className="inline-block px-3 py-1 bg-white/10 border border-white/30 text-white text-[10px] font-black uppercase tracking-[0.25em]">
                                Εξειδικευμένη Τεχνική Υποστήριξη
                            </span>
                        </IndexedFadeInUp>

                        <IndexedFadeInUp index={1}>
                            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white leading-[0.9] tracking-tighter uppercase">
                                Οι Υπηρεσίες <br />
                                <span className="text-[#19657a]">μας</span>
                            </h1>
                        </IndexedFadeInUp>

                        <IndexedFadeInUp index={2}>
                            <p className="text-white/85 text-lg max-w-xl font-light leading-relaxed">
                                Εξειδικευμένη τεχνική υποστήριξη και συμβουλευτική σε όλες τις κατηγορίες χρωμάτων — οικοδομικά, αυτοκινήτου, ναυτιλιακά και ειδικές εφαρμογές.
                            </p>
                        </IndexedFadeInUp>
                    </div>
                </div>
            </section>

            {/* ───── Stats Bar ───── */}
            <section className="bg-primary text-primary-foreground">
                <StaggerContainer className="grid grid-cols-2 md:grid-cols-4">
                    {[
                        { value: '44+', label: 'Χρόνια Εμπειρίας' },
                        { value: '4', label: 'Κατηγορίες Εξειδίκευσης' },
                        { value: '1000+', label: 'Ικανοποιημένοι Πελάτες' },
                        { value: '6', label: 'Εξειδικευμένες Υπηρεσίες' },
                    ].map((stat, index) => (
                        <FadeInUp
                            inStaggerGroup
                            key={stat.label}
                            className={`px-6 md:px-10 py-8 ${index < 3 ? 'border-r border-primary-foreground/10' : ''}`}
                        >
                            <div className="text-3xl md:text-4xl font-black tracking-tight">{stat.value}</div>
                            <div className="text-[10px] uppercase tracking-widest opacity-60 mt-1">{stat.label}</div>
                        </FadeInUp>
                    ))}
                </StaggerContainer>
            </section>

            {/* ───── Specialized Capabilities ───── */}
            <section className="max-w-7xl mx-auto w-full px-6 md:px-10 py-16 md:py-24">
                {/* Section Header */}
                <FadeInUp className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 md:mb-16 gap-6">
                    <div>
                        <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-foreground leading-none mb-4">
                            Εξειδικευμένες <br />
                            <span className="text-accent italic">Υπηρεσίες</span>
                        </h2>
                        <div className="h-1 w-24 bg-accent" />
                    </div>
                    <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
                        Η έμπειρη ομάδα μας σας καθοδηγεί στην επιλογή των κατάλληλων προϊόντων για κάθε εφαρμογή, με βάση τις σύγχρονες τεχνολογικές εξελίξεις.
                    </p>
                </FadeInUp>

                {/* Service Cards Grid */}
                <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 border border-border divide-y md:divide-y-0 md:divide-x divide-border">
                    {[
                        {
                            icon: <Wrench className="w-10 h-10" />,
                            title: 'Τεχνική Συμβουλευτική Οικοδομικών',
                            description: 'Εξειδικευμένες συμβουλές για εσωτερικές και εξωτερικές βαφές, επιλογή χρωμάτων, αντιμετώπιση υγρασίας και μούχλας, θερμομόνωση.',
                            linkLabel: 'Μάθετε Περισσότερα',
                            hoverColor: 'group-hover:text-accent',
                        },
                        {
                            icon: <Palette className="w-10 h-10" />,
                            title: 'Λύσεις για Αυτοκίνητα',
                            description: 'Ολοκληρωμένη υποστήριξη για επαγγελματίες φανοποιούς και ιδιώτες — χρωματισμός, επισκευή, γυάλισμα και περιποίηση.',
                            linkLabel: 'Δείτε Προϊόντα',
                            hoverColor: 'group-hover:text-accent',
                        },
                        {
                            icon: <ShieldCheck className="w-10 h-10" />,
                            title: 'Ναυτιλιακές Εφαρμογές',
                            description: 'Τεχνική καθοδήγηση για σωστή επιλογή υφαλοχρωμάτων, στεγανωτικών και προϊόντων συντήρησης σκαφών.',
                            linkLabel: 'Μάθετε Περισσότερα',
                            hoverColor: 'group-hover:text-foreground',
                        },
                    ].map((service) => (
                        <FadeInUp
                            inStaggerGroup
                            key={service.title}
                            className="group p-8 md:p-10 bg-background hover:bg-muted/30 transition-all duration-300"
                        >
                            <div className={`mb-8 text-muted-foreground ${service.hoverColor} transition-colors duration-300`}>
                                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                    {service.icon}
                                </div>
                            </div>
                            <h3 className="text-lg font-black uppercase tracking-tight mb-4 text-foreground">
                                {service.title}
                            </h3>
                            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
                                {service.description}
                            </p>
                            <Link
                                href="#"
                                className={`inline-flex items-center text-[10px] font-black uppercase tracking-widest border-b-2 border-foreground pb-1 ${service.hoverColor} transition-all duration-300`}
                            >
                                {service.linkLabel}
                            </Link>
                        </FadeInUp>
                    ))}
                </StaggerContainer>

                {/* Additional Services */}
                <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 border border-border border-t-0 divide-y md:divide-y-0 md:divide-x divide-border">
                    {[
                        {
                            icon: <Layers className="w-10 h-10" />,
                            title: 'Βιομηχανικές & Ειδικές Εφαρμογές',
                            description: 'Εξειδικευμένες λύσεις για δάπεδα, πισίνες, μεταλλικές κατασκευές και κάθε ιδιαίτερη εφαρμογή.',
                            linkLabel: 'Δείτε Λύσεις',
                            hoverColor: 'group-hover:text-[#19657a]',
                        },
                        {
                            icon: <Target className="w-10 h-10" />,
                            title: 'Μελέτη Color Matching',
                            description: 'Επαγγελματική αντιστοίχιση χρωμάτων με εξειδικευμένο εξοπλισμό. Εντοπίζουμε την ακριβή απόχρωση για άψογο αποτέλεσμα.',
                            linkLabel: 'Επικοινωνήστε',
                            hoverColor: 'group-hover:text-accent',
                        },
                        {
                            icon: <Droplets className="w-10 h-10" />,
                            title: 'Παρασκευή Αποχρώσεων κατά Παραγγελία',
                            description: 'Custom αποχρώσεις σύμφωνα με τις ακριβείς προδιαγραφές σας, από δείγμα ή μοναδική ιδέα, με ακρίβεια και επαγγελματισμό.',
                            linkLabel: 'Ζητήστε Προσφορά',
                            hoverColor: 'group-hover:text-foreground',
                        },
                    ].map((service) => (
                        <FadeInUp
                            inStaggerGroup
                            key={service.title}
                            className="group p-8 md:p-10 bg-background hover:bg-muted/30 transition-all duration-300"
                        >
                            <div className={`mb-8 text-muted-foreground ${service.hoverColor} transition-colors duration-300`}>
                                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                    {service.icon}
                                </div>
                            </div>
                            <h3 className="text-lg font-black uppercase tracking-tight mb-4 text-foreground">
                                {service.title}
                            </h3>
                            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
                                {service.description}
                            </p>
                            <Link
                                href="#"
                                className={`inline-flex items-center text-[10px] font-black uppercase tracking-widest border-b-2 border-foreground pb-1 ${service.hoverColor} transition-all duration-300`}
                            >
                                {service.linkLabel}
                            </Link>
                        </FadeInUp>
                    ))}
                </StaggerContainer>
            </section>

            {/* ───── Application Protocol ───── */}
            <section className="border-t border-border">
                <div className="flex flex-col md:flex-row">
                    {/* Left Image */}
                    <div className="w-full md:w-1/2 min-h-[350px] md:min-h-[500px] relative overflow-hidden">
                        <Image
                            src="/images/services/approach.webp"
                            alt="Εξειδικευμένος εξοπλισμός χρωμάτων"
                            fill
                            className="object-cover grayscale"
                            sizes="(max-width: 768px) 100vw, 50vw"
                        />
                        <div className="absolute inset-0 bg-[#19657a]/10 mix-blend-multiply" />
                    </div>

                    {/* Right Content */}
                    <div className="w-full md:w-1/2 p-10 md:p-16 lg:p-24 bg-secondary/50 flex flex-col justify-center">
                        <IndexedFadeInUp index={0}>
                            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-accent mb-4 block">
                                Πώς Δουλεύουμε
                            </span>
                        </IndexedFadeInUp>
                        <IndexedFadeInUp index={1}>
                            <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter mb-10 leading-tight text-foreground">
                                Η Διαδικασία <br />Εξυπηρέτησης <br />μας
                            </h2>
                        </IndexedFadeInUp>

                        <StaggerContainer className="space-y-8">
                            {[
                                {
                                    step: '01',
                                    title: 'Αξιολόγηση Αναγκών',
                                    description: 'Ακούμε τις ανάγκες σας και αξιολογούμε την επιφάνεια που θα βαφτεί.',
                                },
                                {
                                    step: '02',
                                    title: 'Επιλογή Προϊόντων',
                                    description: 'Σας προτείνουμε τα κατάλληλα προϊόντα βάσει της εφαρμογής και του προϋπολογισμού σας.',
                                },
                                {
                                    step: '03',
                                    title: 'Τεχνική Καθοδήγηση',
                                    description: 'Σας εξηγούμε αναλυτικά τον τρόπο εφαρμογής για άριστο αποτέλεσμα.',
                                },
                                {
                                    step: '04',
                                    title: 'Συνεχής Υποστήριξη',
                                    description: 'Είμαστε δίπλα σας για οποιαδήποτε απορία κατά και μετά την εφαρμογή.',
                                },
                            ].map((item) => (
                                <FadeInUp inStaggerGroup key={item.step} className="flex gap-5 items-start">
                                    <div className="text-accent font-black text-lg flex-shrink-0 w-8">
                                        {item.step}
                                    </div>
                                    <div>
                                        <h4 className="font-black uppercase text-xs tracking-wide mb-1.5 text-foreground">
                                            {item.title}
                                        </h4>
                                        <p className="text-muted-foreground text-xs leading-relaxed">
                                            {item.description}
                                        </p>
                                    </div>
                                </FadeInUp>
                            ))}
                        </StaggerContainer>
                    </div>
                </div>
            </section>
        </>
    );
}
