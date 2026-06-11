start point is getUrl.js
install dependencies :npm i
run with: node getUrl.js 


Database Setup
PostgreSQL Database Creation
First, create the database and user:

bash
sudo -u postgres psql
Then execute these commands:

sql
CREATE DATABASE medical_research;
CREATE USER med_research_user WITH PASSWORD 'securepassword';
GRANT ALL PRIVILEGES ON DATABASE medical_research TO med_research_user;
ALTER DATABASE medical_research OWNER TO med_research_user;
\q
Table Creation SQL
Run these commands to create the tables:

sql
-- Connect to your database
\c medical_research

-- Items table
CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    arabic_name TEXT NOT NULL
);

-- Diseases table
CREATE TABLE diseases (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL
);

-- Research Results table
CREATE TABLE research_results (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    research_type TEXT,
    weight INTEGER,
    foundation_code TEXT,
    pmc_link TEXT,
    item_name TEXT,
    processing_status TEXT,
    -- Root causes 1-10
    root_cause_1_name TEXT,
    root_cause_1_benefit TEXT,
    root_cause_2_name TEXT,
    root_cause_2_benefit TEXT,
    root_cause_3_name TEXT,
    root_cause_3_benefit TEXT,
    root_cause_4_name TEXT,
    root_cause_4_benefit TEXT,
    root_cause_5_name TEXT,
    root_cause_5_benefit TEXT,
    root_cause_6_name TEXT,
    root_cause_6_benefit TEXT,
    root_cause_7_name TEXT,
    root_cause_7_benefit TEXT,
    root_cause_8_name TEXT,
    root_cause_8_benefit TEXT,
    root_cause_9_name TEXT,
    root_cause_9_benefit TEXT,
    root_cause_10_name TEXT,
    root_cause_10_benefit TEXT,
    -- Lab measures 1-10
    lab_measure_1_name TEXT,
    lab_measure_1_benefit TEXT,
    lab_measure_2_name TEXT,
    lab_measure_2_benefit TEXT,
    lab_measure_3_name TEXT,
    lab_measure_3_benefit TEXT,
    lab_measure_4_name TEXT,
    lab_measure_4_benefit TEXT,
    lab_measure_5_name TEXT,
    lab_measure_5_benefit TEXT,
    lab_measure_6_name TEXT,
    lab_measure_6_benefit TEXT,
    lab_measure_7_name TEXT,
    lab_measure_7_benefit TEXT,
    lab_measure_8_name TEXT,
    lab_measure_8_benefit TEXT,
    lab_measure_9_name TEXT,
    lab_measure_9_benefit TEXT,
    lab_measure_10_name TEXT,
    lab_measure_10_benefit TEXT
);

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO med_research_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO med_research_user;


do not forget to add the credentials in models/all.js