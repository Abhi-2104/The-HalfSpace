import { motion } from "framer-motion";

/** Every route's content enters through this - one consistent, orchestrated
 * transition rather than each page inventing its own entrance. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export const listContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
};

export const listItem = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};
