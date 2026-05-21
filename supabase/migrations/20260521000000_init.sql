create type app_role as enum ('owner','admin','customer');
create type payment_status as enum ('pendiente','pendiente_aprobacion','pagado','rechazado','cancelado','reembolsado');
create type shipping_status as enum ('pendiente','preparando','enviado','entregado','cancelado');

create table profiles (id uuid primary key, role app_role not null default 'customer', display_name text);
create table customers (id uuid primary key default gen_random_uuid(), profile_id uuid references profiles(id), email text unique);
create table products (id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null, active boolean default true, price_cents int not null);
create table product_variants (id uuid primary key default gen_random_uuid(), product_id uuid references products(id) on delete cascade, size text, color text, stock int default 0);
create table orders (id uuid primary key default gen_random_uuid(), customer_id uuid references customers(id), payment_status payment_status default 'pendiente', shipping_status shipping_status default 'pendiente', total_cents int not null);
create table order_items (id uuid primary key default gen_random_uuid(), order_id uuid references orders(id) on delete cascade, product_id uuid references products(id), qty int not null, unit_price_cents int not null);
create table coupons (id uuid primary key default gen_random_uuid(), code text unique not null, discount_percent int, active boolean default true);
create table shipping_methods (id uuid primary key default gen_random_uuid(), name text not null, free_shipping boolean default false, pickup boolean default false);
create table payment_events (id uuid primary key default gen_random_uuid(), order_id uuid references orders(id), provider text not null, status payment_status not null, payload jsonb default '{}'::jsonb);
create table flow_tasks (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), title text not null, done boolean default false);
create table flow_notes (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), content text not null);
create table flow_ideas (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), title text not null, impact int default 1);

alter table products enable row level security;
alter table orders enable row level security;
alter table flow_tasks enable row level security;
alter table flow_notes enable row level security;
alter table flow_ideas enable row level security;

create policy "public can read active products" on products for select using (active=true);
create policy "admin manage products" on products for all using (exists (select 1 from profiles p where p.id=auth.uid() and p.role in ('owner','admin')));
create policy "owner only flow tasks" on flow_tasks for all using (owner_id=auth.uid() and exists (select 1 from profiles p where p.id=auth.uid() and p.role='owner'));
create policy "owner only flow notes" on flow_notes for all using (owner_id=auth.uid() and exists (select 1 from profiles p where p.id=auth.uid() and p.role='owner'));
create policy "owner only flow ideas" on flow_ideas for all using (owner_id=auth.uid() and exists (select 1 from profiles p where p.id=auth.uid() and p.role='owner'));

insert into storage.buckets (id,name,public) values ('product-images','product-images',true),('brand-assets','brand-assets',false);
