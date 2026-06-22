# EXPERIENCE.md - Vital

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Dashboard | App open | Today's health overview at a glance |
| Activity | The Activity tab on Dashboard | Detailed step and calorie tracking with charts |
| BMI Calculator | The BMI card on Dashboard | Calculate BMI from height and weight |
| Goals | The Goals tab on Dashboard | Set and track health goals |
| Profile | The profile avatar on Dashboard | Profile, achievements, and settings |

## Dashboard

Purpose: A vibrant at-a-glance overview of today's activity - the home screen of the app.
Story: dashboard-overview
Layout:
- A top bar with a greeting "Good morning, Alex" and today's date on the left, and a circular profile avatar on the right
- A large hero card with a big circular activity ring (a glowing green progress ring) showing step progress, the number "8,432" large in the centre with "of 10,000 steps" beneath it
- A row of three rounded stat cards side by side: Calories burned with a flame icon ("540 kcal", coral accent), Distance with a route icon ("6.2 km", blue accent), Active minutes with a bolt icon ("47 min", violet accent)
- A "Today's goals" section with three thin horizontal progress bars, each labelled (Steps, Water, Calories) with current/target and a colored fill
- A tappable "Body Mass Index" card showing the current BMI "22.4" and the category "Normal" with a small colored gauge
- A bottom tab bar with five items: Home (active), Activity, a centre round "+" add button, Goals, and Profile
Microcopy:
- greeting: "Good morning, Alex"
- steps: "8,432"
- stepsGoal: "of 10,000 steps"
- calories: "540 kcal"
- distance: "6.2 km"
- activeMinutes: "47 min"
- bmiValue: "22.4"
- bmiCategory: "Normal"
States:
- ring: the activity ring fills proportionally to the step progress
- goalDone: a completed goal bar is full and shows a small check
Nav:
- Activity tab -> Activity
- Goals tab -> Goals
- Body Mass Index card -> BMI Calculator
- Profile avatar -> Profile

## Activity

Purpose: A detailed view of steps and calories with charts and breakdowns.
Story: activity-detail
Layout:
- A top bar with a back chevron on the left and an "Activity" title, with a Day / Week / Month segmented toggle beneath
- A large weekly bar chart of daily steps (seven bars, today's bar highlighted in the primary green), with the week total above it
- A summary row of metric chips: total steps, distance, floors climbed, calories
- A "Calories burned" card with a smooth area/line chart across the day and the total in coral
- An "Hourly steps" list or mini-bars showing the most active hours
- A bottom tab bar matching the Dashboard
Microcopy:
- title: "Activity"
- weekTotal: "52,140 steps this week"
- caloriesTitle: "Calories burned"
States:
- toggle: Week is selected by default
Nav:
- Back chevron -> Dashboard

## BMI Calculator

Purpose: Calculate Body Mass Index from height and weight with a clear, colorful result.
Story: bmi-calc
Layout:
- A top bar with a back chevron and a "BMI Calculator" title
- A Height input shown as a large value with a horizontal slider beneath (e.g. 175 cm) and a cm / ft unit toggle
- A Weight input shown as a large value with a horizontal slider beneath (e.g. 68 kg) and a kg / lb unit toggle
- A prominent result card: a large BMI number "22.4", a horizontal colored BMI gauge (underweight, normal, overweight, obese bands) with a marker on the user's value, and the category label "Normal weight" in green
- A small "Healthy weight range: 57–77 kg" line beneath the result
Microcopy:
- title: "BMI Calculator"
- height: "175 cm"
- weight: "68 kg"
- bmiResult: "22.4"
- category: "Normal weight"
- range: "Healthy range: 57–77 kg"
States:
- band: the gauge marker sits in the green "normal" band for this value
Nav:
- Back chevron -> Dashboard

## Goals

Purpose: Set and track personal health goals with progress rings.
Story: goals-track
Layout:
- A top bar with a back chevron, a "Goals" title, and a "+" button to add a goal
- A featured weekly summary card showing overall goal completion this week
- A vertical list of goal cards, each with an icon, a name, a small progress ring or bar, and "current / target" - for: Daily steps (10,000), Calories burned (600 kcal), Water intake (8 glasses), Sleep (8 h), and Weight target
- Each goal card uses its metric's accent color (steps green, calories coral, water blue, sleep violet)
- A bottom tab bar matching the Dashboard
Microcopy:
- title: "Goals"
- addGoal: "New goal"
- stepsGoal: "Daily steps"
- waterGoal: "Water intake"
States:
- complete: a goal that hit its target shows a filled ring and a check
Nav:
- Back chevron -> Dashboard

## Profile

Purpose: The user's profile, achievements, and settings.
Story: profile
Layout:
- A header with a large circular avatar, the user's name "Alex Carter", and a short stat line (age, height, weight)
- A row of three highlight stats: current streak ("12 day streak"), total steps ("1.2M"), and badges earned ("8 badges")
- An "Achievements" row of colorful badge medallions
- A settings list grouped into rows: Units (metric/imperial), Notifications, Connected devices, Reminders, and Privacy
- An "About Vital" row at the bottom with the version
Microcopy:
- name: "Alex Carter"
- streak: "12 day streak"
- totalSteps: "1.2M steps"
- badges: "8 badges"
- about: "About Vital"
States:
- default: metric units selected
Nav:
- Back chevron -> Dashboard
