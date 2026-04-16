'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ArrowRight, Clock, Phone, MapPin, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IndexedFadeInUp, StaggerContainer, FadeInUp, ImageReveal } from '@/components/ui/motion';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import { APIProvider, Map, Marker } from '@vis.gl/react-google-maps';

const mapStyles = [
    { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
    { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e5e5e5' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#19657a' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#ffffff' }, { weight: 1 }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#19657a' }, { weight: 2 }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#19657a' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9c9c9' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
];

const POSITION = { lat: 40.58309, lng: 22.96459 }; // Εθνικής Αντιστάσεως 66, Καλαμαριά 551 33

const contactSchema = z.object({
    name: z.string().min(2, 'Το όνομα πρέπει να έχει τουλάχιστον 2 χαρακτήρες'),
    email: z.string().email('Η διεύθυνση email δεν είναι έγκυρη'),
    phone: z.string().min(10, 'Το τηλέφωνο πρέπει να έχει τουλάχιστον 10 ψηφία').max(15, 'Μη έγκυρος αριθμός τηλεφώνου'),
    message: z.string().min(10, 'Το μήνυμα πρέπει να έχει τουλάχιστον 10 χαρακτήρες'),
});

type ContactFormValues = z.infer<typeof contactSchema>;

export default function ContactClient() {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<ContactFormValues>({
        resolver: zodResolver(contactSchema),
        defaultValues: {
            name: '',
            email: '',
            phone: '',
            message: '',
        },
    });

    const onSubmit = async (data: ContactFormValues) => {
        if (!db) {
            toast.error('Πρόβλημα σύνδεσης με τη βάση δεδομένων.');
            return;
        }

        setIsSubmitting(true);
        try {
            await addDoc(collection(db, 'contact_inquiries'), {
                ...data,
                status: 'unread',
                createdAt: serverTimestamp(),
            });
            toast.success('Το μήνυμά σας εστάλη επιτυχώς! Θα επικοινωνήσουμε μαζί σας σύντομα.');
            reset();
        } catch (error) {
            console.error('Error submitting form:', error);
            toast.error('Παρουσιάστηκε σφάλμα κατά την αποστολή. Παρακαλώ δοκιμάστε ξανά.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            {/* ───── Hero Section ───── */}
            <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-10 pt-6 md:pt-16 pb-16 md:pb-24">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-16 items-center min-h-[auto] md:min-h-[500px]">
                    <div className="space-y-8 order-2 lg:order-1 py-4 md:py-8">
                        <IndexedFadeInUp index={0}>
                            <span className="inline-block px-3 py-1 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-[0.25em]">
                                Επικοινωνήστε μαζί μας
                            </span>
                        </IndexedFadeInUp>
                        <IndexedFadeInUp index={1}>
                            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black leading-[0.9] tracking-tighter text-foreground uppercase">
                                Επικοινωνία
                            </h1>
                        </IndexedFadeInUp>
                        <IndexedFadeInUp index={2}>
                            <p className="text-muted-foreground max-w-sm text-base sm:text-lg md:text-xl leading-relaxed font-light">
                                Είμαστε στη διάθεσή σας για οποιαδήποτε ερώτηση σχετικά με τα προϊόντα, τις υπηρεσίες μας ή για εξειδικευμένη τεχνική υποστήριξη.
                            </p>
                        </IndexedFadeInUp>
                    </div>

                    <ImageReveal delay={0.2} className="order-1 lg:order-2 h-[300px] sm:h-[400px] md:h-[500px] w-full relative overflow-hidden border border-border group bg-muted/20">
                        {/* Interactive Customized Google Map */}
                        <div className="w-full h-full grayscale-[0.3] opacity-[0.9] transition-all duration-500 group-hover:grayscale-0 group-hover:opacity-100 dark:opacity-[0.85] dark:group-hover:opacity-100 relative z-0">
                            <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || ''}>
                                <Map
                                    defaultCenter={POSITION}
                                    defaultZoom={16}
                                    gestureHandling={'none'} // Disables scroll-to-zoom and pan via drag
                                    disableDefaultUI={true}
                                    zoomControl={true} // Re-enables explicit +/- buttons
                                    styles={mapStyles}
                                >
                                    <Marker position={POSITION} />
                                </Map>
                            </APIProvider>
                        </div>
                        
                        <a 
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Εθνικής Αντιστάσεως 66, Καλαμαριά, 551 33, Θεσσαλονίκη")}`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="absolute bottom-6 left-6 z-20"
                        >
                            <div className="bg-background p-5 border border-foreground shadow-[4px_4px_0px_0px_rgba(25,101,122,1)] transition-all duration-300 hover:shadow-[6px_6px_0px_0px_rgba(25,101,122,1)] hover:-translate-y-0.5 hover:-translate-x-0.5 cursor-pointer">
                                <p className="text-[10px] font-black tracking-[0.2em] uppercase mb-1.5 text-[#19657a] dark:text-[#207a6d]">Καλαμαριά, Θεσσαλονίκη</p>
                                <p className="text-xs font-mono font-bold uppercase tracking-tight text-foreground/90">Εθνικής Αντιστάσεως 66, 551 33</p>
                            </div>
                        </a>
                    </ImageReveal>
                </div>
            </section>

            {/* ───── Form & Locations Grid ───── */}
            <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-10 py-16 md:py-24">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 lg:gap-20">
                    {/* Contact Form Module */}
                    <StaggerContainer className="lg:col-span-2 space-y-12">
                        <FadeInUp inStaggerGroup className="border-b-2 border-foreground pb-4 flex justify-between items-end">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em]">Φόρμα Επικοινωνίας</h3>
                        </FadeInUp>

                        <form className="space-y-10" onSubmit={handleSubmit(onSubmit)}>
                            <FadeInUp inStaggerGroup className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                <div className="flex flex-col gap-3 group relative">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80 group-focus-within:text-primary transition-colors">Ονοματεπώνυμο</label>
                                    <input
                                        type="text"
                                        placeholder="ΤΟ ΟΝΟΜΑ ΣΑΣ"
                                        {...register('name')}
                                        className={`bg-transparent border-0 border-b ${errors.name ? 'border-destructive focus:border-destructive text-destructive' : 'border-border focus:border-primary'} focus:ring-0 placeholder:text-muted-foreground/30 text-sm font-bold py-4 px-0 rounded-none transition-all outline-none`}
                                    />
                                    {errors.name && <span className="text-xs font-medium text-destructive mt-1 absolute -bottom-5 left-0">{errors.name.message}</span>}
                                </div>
                                <div className="flex flex-col gap-3 group relative">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80 group-focus-within:text-primary transition-colors">Email</label>
                                    <input
                                        type="email"
                                        placeholder="ΤΟ EMAIL ΣΑΣ"
                                        {...register('email')}
                                        className={`bg-transparent border-0 border-b ${errors.email ? 'border-destructive focus:border-destructive text-destructive' : 'border-border focus:border-primary'} focus:ring-0 placeholder:text-muted-foreground/30 text-sm font-bold py-4 px-0 rounded-none transition-all outline-none`}
                                    />
                                    {errors.email && <span className="text-xs font-medium text-destructive mt-1 absolute -bottom-5 left-0">{errors.email.message}</span>}
                                </div>
                            </FadeInUp>

                            <FadeInUp inStaggerGroup className="grid grid-cols-1 gap-10">
                                <div className="flex flex-col gap-3 group relative w-full md:w-1/2 md:pr-5">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80 group-focus-within:text-primary transition-colors">Τηλέφωνο</label>
                                    <input
                                        type="tel"
                                        placeholder="ΤΟ ΤΗΛΕΦΩΝΟ ΣΑΣ"
                                        {...register('phone')}
                                        className={`bg-transparent border-0 border-b ${errors.phone ? 'border-destructive focus:border-destructive text-destructive' : 'border-border focus:border-primary'} focus:ring-0 placeholder:text-muted-foreground/30 text-sm font-bold py-4 px-0 rounded-none transition-all outline-none`}
                                    />
                                    {errors.phone && <span className="text-xs font-medium text-destructive mt-1 absolute -bottom-5 left-0">{errors.phone.message}</span>}
                                </div>
                            </FadeInUp>

                            <FadeInUp inStaggerGroup className="flex flex-col gap-3 group relative">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80 group-focus-within:text-primary transition-colors">Μήνυμα</label>
                                <textarea
                                    rows={4}
                                    placeholder="ΠΩΣ ΜΠΟΡΟΥΜΕ ΝΑ ΣΑΣ ΒΟΗΘΗΣΟΥΜΕ;"
                                    {...register('message')}
                                    className={`bg-transparent border-0 border-b ${errors.message ? 'border-destructive focus:border-destructive text-destructive' : 'border-border focus:border-primary'} focus:ring-0 placeholder:text-muted-foreground/30 text-sm font-bold py-4 px-0 resize-none rounded-none transition-all outline-none uppercase leading-relaxed`}
                                />
                                {errors.message && <span className="text-xs font-medium text-destructive mt-1 absolute -bottom-5 left-0">{errors.message.message}</span>}
                            </FadeInUp>

                            <FadeInUp inStaggerGroup>
                                <Button
                                    type="submit"
                                    size="lg"
                                    disabled={isSubmitting}
                                    className="rounded-none px-12 py-8 text-xs font-black uppercase tracking-[0.3em] flex items-center justify-center gap-4 w-fit shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all group disabled:opacity-70 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)]"
                                >
                                    {isSubmitting ? (
                                        <>
                                            Αποστολή...
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        </>
                                    ) : (
                                        <>
                                            Αποστολή Μηνύματος
                                            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                                        </>
                                    )}
                                </Button>
                            </FadeInUp>
                        </form>
                    </StaggerContainer>

                    {/* Sidebar Context */}
                    <StaggerContainer className="space-y-16">
                        {/* Contact Details Block */}
                        <FadeInUp inStaggerGroup className="space-y-6">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3">
                                <span className="p-1.5 bg-primary/10 rounded">
                                    <Phone className="w-4 h-4" />
                                </span>
                                Τηλεφωνική Επικοινωνία
                            </h3>

                            <div className="p-8 bg-secondary/50 border-l-[6px] border-primary relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-2 opacity-5">
                                    <Phone className="w-20 h-20 rotate-12" />
                                </div>
                                <p className="text-[10px] font-mono font-bold mb-3 uppercase tracking-widest text-muted-foreground">Τηλ:</p>
                                <p className="text-2xl font-black tracking-tight text-foreground">2310 447 033</p>
                                <p className="text-lg font-bold tracking-tight text-foreground mt-1">2310 444 329</p>
                                <div className="mt-4 pt-4 border-t border-border/50 space-y-1">
                                    <p className="text-[11px] text-muted-foreground leading-snug font-medium">
                                        Κινητό: <span className="text-foreground font-black">6937 405030</span>
                                    </p>
                                    <p className="text-[11px] text-muted-foreground leading-snug font-medium">
                                        Fax: <span className="text-foreground font-black">2310 446 280</span>
                                    </p>
                                    <p className="text-[11px] text-muted-foreground leading-snug font-medium">
                                        Email: <span className="text-foreground font-black">info@pavlicevits.gr</span>
                                    </p>
                                </div>
                            </div>
                        </FadeInUp>

                        {/* Location Section */}
                        <FadeInUp inStaggerGroup className="space-y-8">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3">
                                <span className="p-1.5 bg-primary/10 rounded">
                                    <MapPin className="w-4 h-4" />
                                </span>
                                Τοποθεσία
                            </h3>

                            <div className="space-y-6">
                                <div className="group border border-border p-7 hover:border-primary hover:bg-muted/30 transition-all duration-300 cursor-default relative overflow-hidden">
                                    <div className="flex justify-between items-start relative z-10">
                                        <div>
                                            <h4 className="text-base font-black uppercase tracking-tight group-hover:text-primary transition-colors">Κατάστημα Καλαμαριάς</h4>
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.1em] mt-1">Κεντρικό Κατάστημα</p>
                                        </div>
                                        <MapPin className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-all duration-300 group-hover:scale-110" />
                                    </div>
                                    <div className="mt-6 text-[12px] text-muted-foreground leading-relaxed font-medium">
                                        <p>Λεωφ. Εθνικής Αντιστάσεως 66</p>
                                        <p>Καλαμαριά, 551 33</p>
                                        <p>Θεσσαλονίκη</p>
                                    </div>
                                </div>
                            </div>
                        </FadeInUp>

                        {/* Operating Hours */}
                        <FadeInUp inStaggerGroup className="space-y-6">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-3">
                                <span className="p-1.5 bg-primary/10 rounded">
                                    <Clock className="w-4 h-4" />
                                </span>
                                Ωράριο Λειτουργίας
                            </h3>

                            <div className="border border-border p-7 space-y-3">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="font-bold uppercase tracking-wide text-foreground">Δευτέρα - Παρασκευή</span>
                                    <span className="font-black text-primary">08:30 - 16:30</span>
                                </div>
                                <div className="border-t border-border/50"></div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="font-bold uppercase tracking-wide text-foreground">Σάββατο</span>
                                    <span className="font-black text-primary">08:30 - 14:30</span>
                                </div>
                                <div className="border-t border-border/50"></div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="font-bold uppercase tracking-wide text-foreground">Κυριακή</span>
                                    <span className="font-black text-muted-foreground">Κλειστά</span>
                                </div>
                            </div>
                        </FadeInUp>
                    </StaggerContainer>
                </div>
            </section>
        </>
    );
}
