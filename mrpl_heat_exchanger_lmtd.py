import numpy as np

# Given data
Th_in = 180.0  # Hot fluid inlet (Kerosene) in C
Th_out = 110.0 # Hot fluid outlet (Kerosene) in C
Tc_in = 40.0   # Cold fluid inlet (Crude oil) in C
Tc_out = 95.0  # Cold fluid outlet (Crude oil) in C
fm_c = 45.0    # Cold fluid mass flow rate (kg/s)
Cp = 2.1       # Specific Heat Capacity (kJ/(kg*K))

# (1) Calculate Temperature Differences Delta T1 and Delta T2
# For counter-current flow:
Delta_T1 = Th_in - Tc_out
Delta_T2 = Th_out - Tc_in

# (2) Calculate Log Mean Temperature Difference (LMTD)
# LMTD = (Delta_T1 - Delta_T2) / ln(Delta_T1 / Delta_T2)

# (3) Calculate Heat Duty Q in kW
# Q = fm_c * Cp * (Tc_out - Tc_in)

# --- Calculations ---

delta_t1 = Th_in - Tc_out
delta_t2 = Th_out - Tc_in

# Check for valid LMTD calculation
if delta_t1 <= 0 or delta_t2 <= 0:
    lmtd = np.nan
else:
    lmtd = (delta_t1 - delta_t2) / np.log(delta_t1 / delta_t2)

heat_duty = fm_c * Cp * (Tc_out - Tc_in)

# --- Output Results ---
print("--- Heat Exchanger Calculations for E-102 ---")
print("1. Temperature Differences")
print(f"Delta T1: {delta_t1:.2f} C")
print(f"Delta T2: {delta_t2:.2f} C")
print("2. Log Mean Temperature Difference (LMTD)")
if np.isnan(lmtd):
    print("LMTD: Cannot be calculated due to invalid temperature differences.")
else:
    print(f"LMTD: {lmtd:.2f} C")
print("3. Heat Duty (Q)")
print(f"Heat Duty Q: {heat_duty / 1000.0:.2f} kW") # Convert kJ to kW
